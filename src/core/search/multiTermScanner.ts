import { AhoCorasick, type AcHit } from '../ahoCorasick';
import { covers, findProtectedSpans } from '../protectedSpans';
import { MAX_FILE_BYTES } from '../query/queryValidation';
import {
	buildExcerpt,
	findHeadings,
	nearestHeading,
} from '../search/headingResolver';
import {
	hasTermBoundary,
	needsBoundaryCheck,
	normalizeTerm,
} from '../search/termMatch';
import {
	foldCase,
	foldCaseWithMapping,
	mapFoldedRange,
	type FoldedText,
} from '../search/caseFold';
import {
	BODY_CHUNK_SIZE,
	type BodyHit,
	type CancelToken,
	yieldToUi,
} from '../search/types';
import type { FileScanInput } from '../search/bodyScanner';

export interface TermScanSpec {
	key: string;
	query: string;
	caseSensitive: boolean;
}

export interface MultiScanOptions {
	excerptLength: number;
	maxHitsPerNote: number;
	token?: CancelToken;
	yieldFn?: () => Promise<void>;
	onChunk?: () => void;
	maxContentBytes?: number;
}

async function yieldScan(opts: MultiScanOptions): Promise<boolean> {
	if (opts.token?.cancelled) {
		return true;
	}
	if (opts.onChunk) {
		opts.onChunk();
	}
	await (opts.yieldFn ?? yieldToUi)();
	return opts.token?.cancelled ?? false;
}

function buildAutomaton(
	terms: TermScanSpec[],
	caseSensitive: boolean,
): {
	automaton: AhoCorasick;
	termByNeedle: Map<string, TermScanSpec>;
} {
	const automaton = new AhoCorasick();
	const termByNeedle = new Map<string, TermScanSpec>();
	const seen = new Set<string>();
	for (const term of terms) {
		if (term.caseSensitive !== caseSensitive) {
			continue;
		}
		const needle = caseSensitive ? term.query.trim() : foldCase(term.query.trim());
		if (!needle || seen.has(needle)) {
			continue;
		}
		seen.add(needle);
		automaton.add(needle);
		termByNeedle.set(needle, term);
	}
	automaton.build();
	return { automaton, termByNeedle };
}

function acceptHit(
	content: string,
	hit: AcHit,
	term: TermScanSpec,
	protectedSpans: { start: number; end: number }[],
): boolean {
	if (covers(protectedSpans, hit.start, hit.end)) {
		return false;
	}
	const original = term.query.trim();
	if (needsBoundaryCheck(original) && !hasTermBoundary(content, hit.start, hit.end, original)) {
		return false;
	}
	if (term.caseSensitive) {
		const slice = content.slice(hit.start, hit.end);
		if (slice !== original) {
			return false;
		}
	}
	return true;
}

function collectChunkHits(
	content: string,
	chunk: string,
	scanText: string,
	chunkStart: number,
	automaton: AhoCorasick,
	termByNeedle: Map<string, TermScanSpec>,
	protectedSpans: { start: number; end: number }[],
	headings: ReturnType<typeof findHeadings>,
	perTermCounts: Map<string, Set<number>>,
	out: Map<string, BodyHit[]>,
	options: MultiScanOptions,
	input: FileScanInput,
	folded?: FoldedText,
): void {
	const rawHits = automaton.find(scanText);
	for (const hit of rawHits) {
		const mapped = folded
			? mapFoldedRange(folded, hit.start, hit.end)
			: { start: hit.start, end: hit.end };
		if (!mapped) {
			continue;
		}
		const absStart = chunkStart + mapped.start;
		const absEnd = chunkStart + mapped.end;
		const term = termByNeedle.get(hit.term);
		if (!term) {
			continue;
		}
		if (!acceptHit(content, { ...hit, start: absStart, end: absEnd }, term, protectedSpans)) {
			continue;
		}
		const offsets = perTermCounts.get(term.key)!;
		if (offsets.has(absStart)) {
			continue;
		}
		offsets.add(absStart);
		const list = out.get(term.key)!;
		if (list.length >= options.maxHitsPerNote) {
			continue;
		}
		const heading = nearestHeading(headings, absStart);
		list.push({
			path: input.path,
			heading: heading?.text ?? '',
			offset: absStart,
			excerpt: buildExcerpt(content, absStart, absEnd, options.excerptLength),
			mtime: input.mtime,
		});
	}
}

export async function scanFileMultiTermsAsync(
	input: FileScanInput,
	terms: TermScanSpec[],
	options: MultiScanOptions,
): Promise<Map<string, BodyHit[]>> {
	const out = new Map<string, BodyHit[]>();
	for (const term of terms) {
		out.set(term.key, []);
	}
	if (terms.length === 0) {
		return out;
	}

	const maxBytes = options.maxContentBytes ?? MAX_FILE_BYTES;
	const content =
		input.content.length > maxBytes ? input.content.slice(0, maxBytes) : input.content;

	const sensitiveTerms = terms.filter((t) => t.caseSensitive);
	const insensitiveTerms = terms.filter((t) => !t.caseSensitive);
	const sensitiveAuto =
		sensitiveTerms.length > 0 ? buildAutomaton(sensitiveTerms, true) : null;
	const insensitiveAuto =
		insensitiveTerms.length > 0 ? buildAutomaton(insensitiveTerms, false) : null;

	const protectedSpans = findProtectedSpans(content);
	const headings = findHeadings(content);

	let maxLen = 0;
	for (const term of terms) {
		const trimmed = term.query.trim();
		maxLen = Math.max(
			maxLen,
			trimmed.length,
			term.caseSensitive ? trimmed.length : foldCase(trimmed).length,
		);
	}
	const overlap = Math.max(0, maxLen - 1);
	const perTermCounts = new Map<string, Set<number>>();
	for (const term of terms) {
		perTermCounts.set(term.key, new Set());
	}

	for (let chunkStart = 0; chunkStart < content.length; chunkStart += BODY_CHUNK_SIZE - overlap) {
		if (await yieldScan(options)) {
			return out;
		}
		let chunkEnd = Math.min(content.length, chunkStart + BODY_CHUNK_SIZE);
		if (
			chunkEnd < content.length &&
			/[\uD800-\uDBFF]/.test(content[chunkEnd - 1] ?? '') &&
			/[\uDC00-\uDFFF]/.test(content[chunkEnd] ?? '')
		) {
			chunkEnd++;
		}
		const chunk = content.slice(chunkStart, chunkEnd);

		if (insensitiveAuto && insensitiveAuto.termByNeedle.size > 0) {
			const folded = foldCaseWithMapping(chunk);
			collectChunkHits(
				content,
				chunk,
				folded.text,
				chunkStart,
				insensitiveAuto.automaton,
				insensitiveAuto.termByNeedle,
				protectedSpans,
				headings,
				perTermCounts,
				out,
				options,
				input,
				folded,
			);
		}
		if (sensitiveAuto && sensitiveAuto.termByNeedle.size > 0) {
			collectChunkHits(
				content,
				chunk,
				chunk,
				chunkStart,
				sensitiveAuto.automaton,
				sensitiveAuto.termByNeedle,
				protectedSpans,
				headings,
				perTermCounts,
				out,
				options,
				input,
			);
		}
	}

	return out;
}

export function normalizeTermKey(query: string, caseSensitive: boolean): string {
	return normalizeTerm(query, caseSensitive);
}
