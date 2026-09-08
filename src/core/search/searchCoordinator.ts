import type { QueryCache } from '../cache/queryCache';
import type { SearchRequest } from '../query/querySource';
import {
	filterHitsToScope,
	mergeCacheHits,
	type ReadFileFn,
	scanFilesForTerm,
} from './bodyScanner';
import { capHitsByNoteCount } from './hitLimits';
import { generationBeforeFailures } from './failureGeneration';
import { scopeFingerprint, type ScopedFile } from './scopeFilter';
import type { BodyHit, CancelToken } from './types';

export interface SearchScanOptions {
	excerptLength: number;
	maxHitsPerNote: number;
	maxCandidateNotes: number;
	readConcurrency: number;
	maxContentBytes?: number;
	onProgress?: (done: number, total: number) => void;
	token?: CancelToken;
	yieldFn?: () => Promise<void>;
	onChunk?: () => void;
}

export interface SearchCoordinatorInput {
	request: SearchRequest;
	scopeSettings: Parameters<typeof scopeFingerprint>[0];
	scopedFiles: ScopedFile[];
	scanOptions: SearchScanOptions;
}

export interface SearchCoordinatorResult {
	hits: BodyHit[];
	filesRead: number;
	readPaths: string[];
	warm: boolean;
	cacheKey: string;
	currentGeneration: number;
}

function cancelled(token?: CancelToken): boolean {
	return token?.cancelled ?? false;
}

export class SearchCoordinator {
	constructor(
		private readonly cache: QueryCache,
		private readonly readFile: ReadFileFn,
	) {}

	async execute(input: SearchCoordinatorInput): Promise<SearchCoordinatorResult> {
		const { request, scopeSettings, scopedFiles, scanOptions } = input;
		const scopeFp = scopeFingerprint(scopeSettings);
		const cacheKey = this.cache.makeKey(request.query, request.caseSensitive, scopeFp);
		const scopePaths = new Set(scopedFiles.map((f) => f.path));

		const currentGeneration = this.cache.manifest.reconcile(
			scopedFiles.map((f) => ({ path: f.path, mtime: f.statMtime })),
		);

		const readPaths: string[] = [];
		const trackingRead: ReadFileFn = async (path) => {
			readPaths.push(path);
			return this.readFile(path);
		};

		const bodyOptions = {
			query: request.query,
			caseSensitive: request.caseSensitive,
			excerptLength: scanOptions.excerptLength,
			maxHitsPerNote: scanOptions.maxHitsPerNote,
			maxCandidateNotes: scanOptions.maxCandidateNotes,
			readConcurrency: scanOptions.readConcurrency,
			token: scanOptions.token,
			yieldFn: scanOptions.yieldFn,
			onChunk: scanOptions.onChunk,
			maxContentBytes: scanOptions.maxContentBytes,
			onProgress: scanOptions.onProgress,
		};

		const cached = this.cache.get(cacheKey);

		if (cached) {
			const snapshotHits = filterHitsToScope(cached.hits, scopePaths);
			let hits = snapshotHits;
			const rescannedPaths = this.cache.manifest.pathsNeedingRescan(
				[...scopePaths],
				cached.scannedGeneration,
			);

			if (rescannedPaths.length === 0) {
				if (!cancelled(scanOptions.token)) {
					this.cache.updateEntry(cacheKey, { scannedGeneration: currentGeneration });
				}
				return {
					hits: capHitsByNoteCount(snapshotHits, scanOptions.maxCandidateNotes),
					filesRead: 0,
					readPaths,
					warm: true,
					cacheKey,
					currentGeneration,
				};
			}

			const rescanSet = new Set(rescannedPaths);
			const rescanFiles = scopedFiles.filter((f) => rescanSet.has(f.path));
			const partial = await scanFilesForTerm(
				rescanFiles.map((f) => ({ path: f.path, content: '', mtime: f.statMtime })),
				trackingRead,
				bodyOptions,
			);

			if (cancelled(scanOptions.token)) {
				return {
					hits: capHitsByNoteCount(snapshotHits, scanOptions.maxCandidateNotes),
					filesRead: partial.filesRead,
					readPaths,
					warm: false,
					cacheKey,
					currentGeneration,
				};
			}

			const successfulRescanSet = new Set(
				rescannedPaths.filter((path) => !partial.failedPaths.has(path)),
			);
			hits = mergeCacheHits(snapshotHits, partial.hits, successfulRescanSet);
			hits = filterHitsToScope(hits, scopePaths);
			hits = capHitsByNoteCount(hits, scanOptions.maxCandidateNotes);
			const scannedGeneration = generationBeforeFailures(
				this.cache.manifest,
				currentGeneration,
				cached.scannedGeneration,
				partial.failedPaths,
			);
			this.cache.updateEntry(cacheKey, {
				hits,
				scannedGeneration,
			});

			return {
				hits,
				filesRead: partial.filesRead,
				readPaths,
				warm: partial.filesRead === 0,
				cacheKey,
				currentGeneration,
			};
		}

		const cold = await scanFilesForTerm(
			scopedFiles.map((f) => ({ path: f.path, content: '', mtime: f.statMtime })),
			trackingRead,
			bodyOptions,
		);

		if (cancelled(scanOptions.token)) {
			return {
				hits: capHitsByNoteCount(cold.hits, scanOptions.maxCandidateNotes),
				filesRead: cold.filesRead,
				readPaths,
				warm: false,
				cacheKey,
				currentGeneration,
			};
		}

		const scannedGeneration = generationBeforeFailures(
			this.cache.manifest,
			currentGeneration,
			0,
			cold.failedPaths,
		);
		this.cache.set(cacheKey, {
			hits: cold.hits,
			scopeFingerprint: scopeFp,
			caseSensitive: request.caseSensitive,
			scannedGeneration,
		});

		return {
			hits: capHitsByNoteCount(cold.hits, scanOptions.maxCandidateNotes),
			filesRead: cold.filesRead,
			readPaths,
			warm: false,
			cacheKey,
			currentGeneration,
		};
	}
}
