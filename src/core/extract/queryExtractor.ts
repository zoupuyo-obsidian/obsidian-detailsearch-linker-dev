import { covers, findProtectedSpans } from '../protectedSpans';
import { normalizeTerm } from '../search/termMatch';
import { validateQuery } from '../query/queryValidation';

export type ExtractSource = 'heading' | 'emphasis' | 'highlight' | 'prose' | 'ngram';

export interface ExtractAnchor {
	from: number;
	to: number;
	text: string;
}

export interface ExtractedCandidate {
	query: string;
	displayText: string;
	source: ExtractSource;
	score: number;
	anchors: ExtractAnchor[];
}

export interface ExtractSettings {
	focusedExtraction: boolean;
	normalProsePhrases: boolean;
	broadNgram: boolean;
	minTermLength: number;
	maxTermLength: number;
	ngramMinLength: number;
	ngramMaxLength: number;
	maxAutoQueries: number;
	ngramSpanLimit: number;
	stopWords: string[];
	ignoredTerms: string[];
	caseSensitive: boolean;
}

export const HARD_CAP_AUTO_QUERIES = 200;
const PROSE_PHRASES_PER_LINE = 16;
const MAX_PHRASE_WORDS = 3;

const CJK_RUN =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const TIER: Record<ExtractSource, number> = {
	heading: 1000,
	emphasis: 1200,
	highlight: 1200,
	prose: 400,
	ngram: 100,
};

export function tierScore(source: ExtractSource, text: string): number {
	const base = TIER[source];
	if (source === 'prose' || source === 'ngram') {
		return base + Math.min(text.length, 80);
	}
	return base;
}

function isValidSpan(
	text: string,
	from: number,
	to: number,
	protectedSpans: { start: number; end: number }[],
): boolean {
	if (to <= from) {
		return false;
	}
	if (covers(protectedSpans, from, to)) {
		return false;
	}
	const slice = text.slice(from, to);
	if (validateQuery(slice)) {
		return false;
	}
	return true;
}

function trimSpan(text: string, from: number, to: number): { from: number; to: number; query: string } | null {
	const raw = text.slice(from, to);
	const leading = raw.length - raw.trimStart().length;
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}
	const adjFrom = from + leading;
	const adjTo = adjFrom + trimmed.length;
	return { from: adjFrom, to: adjTo, query: trimmed };
}

function pushRaw(
	out: ExtractedCandidate[],
	text: string,
	from: number,
	to: number,
	source: ExtractSource,
	protectedSpans: { start: number; end: number }[],
): void {
	const trimmed = trimSpan(text, from, to);
	if (!trimmed) {
		return;
	}
	if (!isValidSpan(text, trimmed.from, trimmed.to, protectedSpans)) {
		return;
	}
	out.push({
		query: trimmed.query,
		displayText: trimmed.query,
		source,
		score: tierScore(source, trimmed.query),
		anchors: [{ from: trimmed.from, to: trimmed.to, text: trimmed.query }],
	});
}

function extractHeadingsList(
	text: string,
	protectedSpans: ReturnType<typeof findProtectedSpans>,
): ExtractedCandidate[] {
	const out: ExtractedCandidate[] = [];
	const re = /^( {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const lineStart = m.index;
		const content = m[3]!.trim();
		if (!content) {
			continue;
		}
		const prefix = m[0].indexOf(content);
		const from = lineStart + prefix;
		const to = from + content.length;
		pushRaw(out, text, from, to, 'heading', protectedSpans);
	}
	return out;
}

function extractInlinePattern(
	text: string,
	re: RegExp,
	source: ExtractSource,
	protectedSpans: ReturnType<typeof findProtectedSpans>,
	innerGroup = 1,
): ExtractedCandidate[] {
	const out: ExtractedCandidate[] = [];
	let m: RegExpExecArray | null;
	const rx = new RegExp(re.source, re.flags);
	while ((m = rx.exec(text)) !== null) {
		const inner = m[innerGroup];
		if (!inner) {
			continue;
		}
		const start = m.index + m[0].indexOf(inner);
		pushRaw(out, text, start, start + inner.length, source, protectedSpans);
	}
	return out;
}

interface WordSpan {
	segment: string;
	from: number;
	to: number;
	isWordLike: boolean;
}

function segmentWordsWithOffsets(line: string): WordSpan[] {
	type WordSegment = { segment: string; index: number; isWordLike?: boolean };
	type WordSegmenter = { segment(input: string): Iterable<WordSegment> };
	type SegmenterCtor = new (
		locales?: string | string[],
		options?: { granularity: 'word' | 'sentence' | 'grapheme' },
	) => WordSegmenter;
	const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterCtor }).Segmenter;
	if (Segmenter) {
		const seg = new Segmenter(undefined, { granularity: 'word' });
		const out: WordSpan[] = [];
		for (const part of seg.segment(line)) {
			out.push({
				segment: part.segment,
				from: part.index,
				to: part.index + part.segment.length,
				isWordLike: !!part.isWordLike,
			});
		}
		return out;
	}
	const out: WordSpan[] = [];
	const re = /[\p{L}\p{M}\p{N}]+/gu;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		out.push({
			segment: m[0],
			from: m.index,
			to: m.index + m[0].length,
			isWordLike: true,
		});
	}
	return out;
}

function isLatinWord(segment: string): boolean {
	return /^[\p{L}\p{M}\p{N}]+$/u.test(segment);
}

function gapIsPhraseSafe(line: string, from: number, to: number): boolean {
	if (from >= to) {
		return true;
	}
	const gap = line.slice(from, to);
	if (!gap) {
		return true;
	}
	if (/[#*`[\]|=_~]/.test(gap)) {
		return false;
	}
	return /^[\s\u3000]*$/u.test(gap);
}

function phraseFromWordSpans(line: string, words: WordSpan[], start: number, count: number): string | null {
	const slice = words.slice(start, start + count);
	if (slice.length !== count) {
		return null;
	}
	for (let i = 1; i < slice.length; i++) {
		const prev = slice[i - 1]!;
		const curr = slice[i]!;
		if (!gapIsPhraseSafe(line, prev.to, curr.from)) {
			return null;
		}
	}
	const allLatin = slice.every((w) => isLatinWord(w.segment));
	if (allLatin) {
		return line.slice(slice[0]!.from, slice[slice.length - 1]!.to).trim();
	}
	return slice.map((w) => w.segment).join('');
}

function extractProse(
	text: string,
	settings: ExtractSettings,
	protectedSpans: ReturnType<typeof findProtectedSpans>,
): ExtractedCandidate[] {
	const out: ExtractedCandidate[] = [];
	const lines = text.split('\n');
	let offset = 0;
	for (const line of lines) {
		if (/^\s{0,3}#{1,6}\s/.test(line)) {
			offset += line.length + 1;
			continue;
		}
		const spans = segmentWordsWithOffsets(line).filter((s) => s.isWordLike);
		let emitted = 0;
		for (let phraseLen = MAX_PHRASE_WORDS; phraseLen >= 1; phraseLen--) {
			for (let i = 0; i + phraseLen <= spans.length; i++) {
				if (emitted >= PROSE_PHRASES_PER_LINE) {
					break;
				}
				const phrase = phraseFromWordSpans(line, spans, i, phraseLen);
				if (!phrase) {
					continue;
				}
				const from = offset + spans[i]!.from;
				const to = offset + spans[i + phraseLen - 1]!.to;
				if (phrase.length >= settings.minTermLength && phrase.length <= settings.maxTermLength) {
					pushRaw(out, text, from, to, 'prose', protectedSpans);
					emitted++;
				}
			}
		}
		offset += line.length + 1;
	}
	return out;
}

function extractNgrams(
	text: string,
	settings: ExtractSettings,
	protectedSpans: ReturnType<typeof findProtectedSpans>,
): ExtractedCandidate[] {
	const out: ExtractedCandidate[] = [];
	let m: RegExpExecArray | null;
	const rx = new RegExp(CJK_RUN.source, CJK_RUN.flags);
	while ((m = rx.exec(text)) !== null) {
		const run = m[0];
		const base = m.index;
		let emitted = 0;
		for (let len = settings.ngramMaxLength; len >= settings.ngramMinLength; len--) {
			for (let i = 0; i + len <= run.length; i++) {
				if (emitted >= settings.ngramSpanLimit) {
					break;
				}
				const slice = run.slice(i, i + len);
				const from = base + i;
				const to = from + len;
				if (slice.length >= settings.ngramMinLength) {
					pushRaw(out, text, from, to, 'ngram', protectedSpans);
					emitted++;
				}
			}
		}
	}
	return out;
}

function stopSet(settings: ExtractSettings): Set<string> {
	return new Set(
		settings.stopWords.map((w) => normalizeTerm(w, settings.caseSensitive)).filter(Boolean),
	);
}

function ignoredSet(settings: ExtractSettings): Set<string> {
	return new Set(
		settings.ignoredTerms.map((w) => normalizeTerm(w, settings.caseSensitive)).filter(Boolean),
	);
}

function mergeCandidates(raw: ExtractedCandidate[], settings: ExtractSettings): ExtractedCandidate[] {
	const stop = stopSet(settings);
	const ignored = ignoredSet(settings);
	const byKey = new Map<string, ExtractedCandidate>();

	for (const item of raw) {
		const key = normalizeTerm(item.query, settings.caseSensitive);
		if (!key || stop.has(key) || ignored.has(key)) {
			continue;
		}
		if (key.length < settings.minTermLength || key.length > settings.maxTermLength) {
			if (item.source !== 'ngram' || key.length > settings.ngramMaxLength) {
				if (
					item.source === 'prose' ||
					item.source === 'heading' ||
					item.source === 'emphasis' ||
					item.source === 'highlight'
				) {
					if (key.length < settings.minTermLength || key.length > settings.maxTermLength) {
						continue;
					}
				}
			}
		}
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, { ...item, query: item.query.trim(), anchors: [...item.anchors] });
			continue;
		}
		if (item.score > existing.score) {
			existing.source = item.source;
			existing.score = item.score;
			existing.displayText = item.displayText;
		}
		for (const anchor of item.anchors) {
			const dup = existing.anchors.some((a) => a.from === anchor.from && a.to === anchor.to);
			if (!dup) {
				existing.anchors.push(anchor);
			}
		}
	}

	const sorted = [...byKey.values()].sort(
		(a, b) => b.score - a.score || b.query.length - a.query.length,
	);
	const cap = Math.min(settings.maxAutoQueries, HARD_CAP_AUTO_QUERIES);
	return sorted.slice(0, cap);
}

export function extractQueryCandidates(text: string, settings: ExtractSettings): ExtractedCandidate[] {
	const protectedSpans = findProtectedSpans(text);
	const raw: ExtractedCandidate[] = [];

	if (settings.focusedExtraction) {
		raw.push(...extractHeadingsList(text, protectedSpans));
		raw.push(...extractInlinePattern(text, /\*\*(.+?)\*\*/g, 'emphasis', protectedSpans));
		raw.push(...extractInlinePattern(text, /__(.+?)__/g, 'emphasis', protectedSpans));
		raw.push(...extractInlinePattern(text, /==(.+?)==/g, 'highlight', protectedSpans));
	}

	if (settings.normalProsePhrases) {
		raw.push(...extractProse(text, settings, protectedSpans));
	}

	if (settings.broadNgram) {
		raw.push(...extractNgrams(text, settings, protectedSpans));
	}

	return mergeCandidates(raw, settings);
}

export function groupKeyForQuery(query: string, caseSensitive: boolean): string {
	return normalizeTerm(query, caseSensitive);
}

export { trimSpan };
