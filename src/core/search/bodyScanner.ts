import { covers, findProtectedSpans } from '../protectedSpans';
import {
	buildExcerpt,
	findHeadings,
	nearestHeading,
} from './headingResolver';
import {
	hasTermBoundary,
	needsBoundaryCheck,
	normalizeTerm,
} from './termMatch';
import {
	foldCase,
	foldCaseWithMapping,
	mapFoldedRange,
} from './caseFold';
import { MAX_FILE_BYTES } from '../query/queryValidation';
import {
	BODY_CHUNK_SIZE,
	type BodyHit,
	type CancelToken,
	yieldToUi,
} from './types';

export interface FileScanInput {
	path: string;
	content: string;
	mtime: number;
}

export interface ScanFileOptions {
	query: string;
	caseSensitive: boolean;
	excerptLength: number;
	maxHitsPerNote: number;
}

export interface AsyncScanFileOptions extends ScanFileOptions {
	token?: CancelToken;
	yieldFn?: () => Promise<void>;
	onChunk?: () => void;
	maxContentBytes?: number;
}

async function yieldScan(opts: AsyncScanFileOptions): Promise<boolean> {
	if (opts.token?.cancelled) {
		return true;
	}
	if (opts.onChunk) {
		opts.onChunk();
	}
	await (opts.yieldFn ?? yieldToUi)();
	return opts.token?.cancelled ?? false;
}

export async function scanFileContentAsync(
	input: FileScanInput,
	options: AsyncScanFileOptions,
): Promise<BodyHit[]> {
	const { query, caseSensitive, excerptLength, maxHitsPerNote } = options;
	const trimmed = query.trim();
	if (!trimmed) {
		return [];
	}

	const maxBytes = options.maxContentBytes ?? MAX_FILE_BYTES;
	const content =
		input.content.length > maxBytes ? input.content.slice(0, maxBytes) : input.content;

	const protectedSpans = findProtectedSpans(content);
	const headings = findHeadings(content);
	const needle = caseSensitive ? trimmed : foldCase(trimmed);
	const overlap = Math.max(0, trimmed.length, needle.length) - 1;
	const hits: BodyHit[] = [];
	const seenOffsets = new Set<number>();

	for (
		let chunkStart = 0;
		chunkStart < content.length;
		chunkStart += BODY_CHUNK_SIZE - overlap
	) {
		if (await yieldScan(options)) {
			return hits;
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
		const folded = caseSensitive ? null : foldCaseWithMapping(chunk);
		const scanText = folded?.text ?? chunk;
		let pos = 0;
		while (pos <= scanText.length - needle.length) {
			const idx = scanText.indexOf(needle, pos);
			if (idx === -1) {
				break;
			}
			const foldedEnd = idx + needle.length;
			const mapped = folded
				? mapFoldedRange(folded, idx, foldedEnd)
				: { start: idx, end: foldedEnd };
			if (!mapped) {
				pos = idx + 1;
				continue;
			}
			const absStart = chunkStart + mapped.start;
			const absEnd = chunkStart + mapped.end;
			if (covers(protectedSpans, absStart, absEnd)) {
				pos = idx + 1;
				continue;
			}
			if (
				needsBoundaryCheck(trimmed) &&
				!hasTermBoundary(content, absStart, absEnd, trimmed)
			) {
				pos = idx + 1;
				continue;
			}
			if (!seenOffsets.has(absStart)) {
				seenOffsets.add(absStart);
				const heading = nearestHeading(headings, absStart);
				hits.push({
					path: input.path,
					heading: heading?.text ?? '',
					offset: absStart,
					excerpt: buildExcerpt(content, absStart, absEnd, excerptLength),
					mtime: input.mtime,
				});
				if (hits.length >= maxHitsPerNote) {
					return hits;
				}
			}
			pos = idx + 1;
		}
	}

	return hits;
}

/** @deprecated Tests may call sync helper; runtime uses scanFileContentAsync. */
export function scanFileContent(input: FileScanInput, options: ScanFileOptions): BodyHit[] {
	const { query, caseSensitive, excerptLength, maxHitsPerNote } = options;
	const trimmed = query.trim();
	if (!trimmed) {
		return [];
	}
	const maxBytes = MAX_FILE_BYTES;
	const content =
		input.content.length > maxBytes ? input.content.slice(0, maxBytes) : input.content;
	const protectedSpans = findProtectedSpans(content);
	const headings = findHeadings(content);
	const needle = caseSensitive ? trimmed : foldCase(trimmed);
	const overlap = Math.max(0, trimmed.length, needle.length) - 1;
	const hits: BodyHit[] = [];
	const seenOffsets = new Set<number>();
	for (
		let chunkStart = 0;
		chunkStart < content.length;
		chunkStart += BODY_CHUNK_SIZE - overlap
	) {
		let chunkEnd = Math.min(content.length, chunkStart + BODY_CHUNK_SIZE);
		if (
			chunkEnd < content.length &&
			/[\uD800-\uDBFF]/.test(content[chunkEnd - 1] ?? '') &&
			/[\uDC00-\uDFFF]/.test(content[chunkEnd] ?? '')
		) {
			chunkEnd++;
		}
		const chunk = content.slice(chunkStart, chunkEnd);
		const folded = caseSensitive ? null : foldCaseWithMapping(chunk);
		const scanText = folded?.text ?? chunk;
		let pos = 0;
		while (pos <= scanText.length - needle.length) {
			const idx = scanText.indexOf(needle, pos);
			if (idx === -1) {
				break;
			}
			const foldedEnd = idx + needle.length;
			const mapped = folded
				? mapFoldedRange(folded, idx, foldedEnd)
				: { start: idx, end: foldedEnd };
			if (!mapped) {
				pos = idx + 1;
				continue;
			}
			const absStart = chunkStart + mapped.start;
			const absEnd = chunkStart + mapped.end;
			if (covers(protectedSpans, absStart, absEnd)) {
				pos = idx + 1;
				continue;
			}
			if (
				needsBoundaryCheck(trimmed) &&
				!hasTermBoundary(content, absStart, absEnd, trimmed)
			) {
				pos = idx + 1;
				continue;
			}
			if (!seenOffsets.has(absStart)) {
				seenOffsets.add(absStart);
				const heading = nearestHeading(headings, absStart);
				hits.push({
					path: input.path,
					heading: heading?.text ?? '',
					offset: absStart,
					excerpt: buildExcerpt(content, absStart, absEnd, excerptLength),
					mtime: input.mtime,
				});
				if (hits.length >= maxHitsPerNote) {
					return hits;
				}
			}
			pos = idx + 1;
		}
	}
	return hits;
}

export interface ReadFileFn {
	(path: string): Promise<{ content: string; mtime: number } | null>;
}

export interface BodyScanOptions extends ScanFileOptions {
	maxCandidateNotes: number;
	readConcurrency: number;
	onProgress?: (done: number, total: number) => void;
	token?: CancelToken;
	yieldFn?: () => Promise<void>;
	onChunk?: () => void;
	maxContentBytes?: number;
}

export async function scanFilesForTerm(
	files: FileScanInput[],
	readFile: ReadFileFn | null,
	options: BodyScanOptions,
): Promise<{ hits: BodyHit[]; filesRead: number; failedPaths: Set<string> }> {
	const noteHits = new Map<string, BodyHit[]>();
	const failedPaths = new Set<string>();
	let filesRead = 0;
	const total = files.length;
	let done = 0;

	const processFile = async (file: FileScanInput | string): Promise<void> => {
		if (options.token?.cancelled) {
			return;
		}
		let input: FileScanInput;
		if (typeof file === 'string') {
			if (!readFile) {
				return;
			}
			const loaded = await readFile(file);
			if (!loaded) {
				failedPaths.add(file);
				done++;
				options.onProgress?.(done, total);
				await (options.yieldFn ?? yieldToUi)();
				return;
			}
			filesRead++;
			input = { path: file, content: loaded.content, mtime: loaded.mtime };
		} else {
			input = file;
		}

		const fileHits = await scanFileContentAsync(input, options);
		if (fileHits.length > 0) {
			noteHits.set(input.path, fileHits);
		}
		done++;
		options.onProgress?.(done, total);
		await (options.yieldFn ?? yieldToUi)();
	};

	if (readFile) {
		let index = 0;
		const workers = Math.max(1, Math.min(options.readConcurrency, 2));
		const worker = async (): Promise<void> => {
			while (index < files.length) {
				if (options.token?.cancelled) {
					return;
				}
				const i = index++;
				const f = files[i];
				if (!f) {
					return;
				}
				await processFile(typeof f === 'string' ? f : f.path);
			}
		};
		await Promise.all(Array.from({ length: workers }, () => worker()));
	} else {
		for (const file of files) {
			if (options.token?.cancelled) {
				break;
			}
			await processFile(file);
		}
	}

	const hits: BodyHit[] = [];
	const paths = [...noteHits.keys()].sort();
	let noteCount = 0;
	for (const path of paths) {
		if (noteCount >= options.maxCandidateNotes) {
			break;
		}
		const fileHits = noteHits.get(path) ?? [];
		for (const hit of fileHits) {
			hits.push(hit);
		}
		noteCount++;
	}

	return { hits, filesRead, failedPaths };
}

export function filterHitsToScope(hits: BodyHit[], scopePaths: ReadonlySet<string>): BodyHit[] {
	return hits.filter((h) => scopePaths.has(h.path));
}

export function mergeCacheHits(
	existing: BodyHit[],
	rescanned: BodyHit[],
	rescannedPaths: ReadonlySet<string>,
): BodyHit[] {
	const kept = existing.filter((h) => !rescannedPaths.has(h.path));
	return [...kept, ...rescanned].sort(
		(a, b) => a.path.localeCompare(b.path) || a.offset - b.offset,
	);
}

export function normalizeQueryKey(query: string, caseSensitive: boolean): string {
	return normalizeTerm(query, caseSensitive);
}
