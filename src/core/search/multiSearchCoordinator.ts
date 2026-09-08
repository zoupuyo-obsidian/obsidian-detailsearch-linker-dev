import type { QueryCache } from '../cache/queryCache';
import {
	filterHitsToScope,
	type ReadFileFn,
} from './bodyScanner';
import { generationBeforeFailures } from './failureGeneration';
import { capHitsByNoteCount } from './hitLimits';
import { scanFileMultiTermsAsync, type TermScanSpec } from './multiTermScanner';
import { scopeFingerprint, type ScopedFile } from './scopeFilter';
import type { BodyHit, CancelToken } from './types';

export interface MultiTermRequest {
	key: string;
	query: string;
	caseSensitive: boolean;
}

export interface MultiSearchScanOptions {
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

export interface MultiSearchInput {
	terms: MultiTermRequest[];
	scopeSettings: Parameters<typeof scopeFingerprint>[0];
	scopedFiles: ScopedFile[];
	scanOptions: MultiSearchScanOptions;
}

export interface TermSearchOutcome {
	key: string;
	query: string;
	hits: BodyHit[];
	warm: boolean;
}

export interface MultiSearchResult {
	byTerm: Map<string, TermSearchOutcome>;
	filesRead: number;
	readPaths: string[];
	readCountByPath: Map<string, number>;
	currentGeneration: number;
	allWarm: boolean;
	anyPartial: boolean;
}

export function mergeUpdatedPathHits(
	existing: BodyHit[],
	updatedPathHits: ReadonlyMap<string, BodyHit[]>,
	scopePaths: ReadonlySet<string>,
): BodyHit[] {
	const merged: BodyHit[] = [];
	for (const hit of existing) {
		if (scopePaths.has(hit.path) && !updatedPathHits.has(hit.path)) {
			merged.push(hit);
		}
	}
	for (const pathHits of updatedPathHits.values()) {
		for (const hit of pathHits) {
			if (scopePaths.has(hit.path)) {
				merged.push(hit);
			}
		}
	}
	return merged.sort(
		(a, b) => a.path.localeCompare(b.path) || a.offset - b.offset,
	);
}

function cancelled(token?: CancelToken): boolean {
	return token?.cancelled ?? false;
}

export class MultiSearchCoordinator {
	constructor(
		private readonly cache: QueryCache,
		private readonly readFile: ReadFileFn,
	) {}

	async execute(input: MultiSearchInput): Promise<MultiSearchResult> {
		const { terms, scopeSettings, scopedFiles, scanOptions } = input;
		const scopeFp = scopeFingerprint(scopeSettings);
		const scopePaths = new Set(scopedFiles.map((f) => f.path));
		const scopedFilesByPath = new Map<string, ScopedFile>();
		for (const file of scopedFiles) {
			if (!scopedFilesByPath.has(file.path)) {
				scopedFilesByPath.set(file.path, file);
			}
		}
		const currentGeneration = this.cache.manifest.reconcile(
			scopedFiles.map((f) => ({ path: f.path, mtime: f.statMtime })),
		);

		interface Plan {
			key: string;
			query: string;
			caseSensitive: boolean;
			cacheKey: string;
			existingHits: BodyHit[];
			pathsToScan: Set<string>;
			scannedGeneration: number;
			hadCache: boolean;
		}

		const plans: Plan[] = [];
		const plansByKey = new Map<string, Plan>();
		const plansByCacheKey = new Map<string, Plan>();
		const pathToTerms = new Map<string, TermScanSpec[]>();

		for (const term of terms) {
			const cacheKey = this.cache.makeKey(term.query, term.caseSensitive, scopeFp);
			const cached = this.cache.get(cacheKey);
			const existingHits = cached ? filterHitsToScope(cached.hits, scopePaths) : [];
			const pathsToScan = new Set(
				cached
					? this.cache.manifest.pathsNeedingRescan([...scopePaths], cached.scannedGeneration)
					: [...scopePaths],
			);

			for (const path of pathsToScan) {
				const list = pathToTerms.get(path) ?? [];
				list.push({ key: term.key, query: term.query, caseSensitive: term.caseSensitive });
				pathToTerms.set(path, list);
			}

			const plan: Plan = {
				key: term.key,
				query: term.query,
				caseSensitive: term.caseSensitive,
				cacheKey,
				existingHits,
				pathsToScan,
				scannedGeneration: cached?.scannedGeneration ?? 0,
				hadCache: !!cached,
			};
			plans.push(plan);
			if (!plansByKey.has(plan.key)) {
				plansByKey.set(plan.key, plan);
			}
			if (!plansByCacheKey.has(plan.cacheKey)) {
				plansByCacheKey.set(plan.cacheKey, plan);
			}
		}

		const pathsToRead = [...pathToTerms.keys()];
		const readPaths: string[] = [];
		const readCountByPath = new Map<string, number>();
		const pending = new Map<string, Map<string, BodyHit[]>>();
		const failedPathsByCacheKey = new Map<string, Set<string>>();
		for (const cacheKey of plansByCacheKey.keys()) {
			pending.set(cacheKey, new Map());
			failedPathsByCacheKey.set(cacheKey, new Set());
		}

		const pinnedKeys = plans.map((p) => p.cacheKey);
		this.cache.pinActiveKeys(pinnedKeys);

		let filesRead = 0;
		let done = 0;
		const total = pathsToRead.length;

		const byTerm = new Map<string, TermSearchOutcome>();
		let allWarm = terms.length > 0;
		let anyPartial = false;

		try {
			const processPath = async (path: string): Promise<void> => {
				if (cancelled(scanOptions.token)) {
					return;
				}
				const termsForPath = pathToTerms.get(path) ?? [];
				if (termsForPath.length === 0) {
					return;
				}
				const loaded = await this.readFile(path);
				readPaths.push(path);
				readCountByPath.set(path, (readCountByPath.get(path) ?? 0) + 1);
				done++;
				scanOptions.onProgress?.(done, total);
				if (!loaded) {
					for (const term of termsForPath) {
						const plan = plansByKey.get(term.key);
						if (plan) {
							failedPathsByCacheKey.get(plan.cacheKey)?.add(path);
						}
					}
					return;
				}
				filesRead++;
				const file = scopedFilesByPath.get(path);
				const mtime = file?.statMtime ?? loaded.mtime;
				const hitsByTerm = await scanFileMultiTermsAsync(
					{ path, content: loaded.content, mtime },
					termsForPath,
					{
						excerptLength: scanOptions.excerptLength,
						maxHitsPerNote: scanOptions.maxHitsPerNote,
						token: scanOptions.token,
						yieldFn: scanOptions.yieldFn,
						onChunk: scanOptions.onChunk,
						maxContentBytes: scanOptions.maxContentBytes,
					},
				);
				if (cancelled(scanOptions.token)) {
					return;
				}
				for (const term of termsForPath) {
					const plan = plansByKey.get(term.key);
					if (!plan) {
						continue;
					}
					const pathHits = hitsByTerm.get(term.key) ?? [];
					pending.get(plan.cacheKey)?.set(path, pathHits);
				}
			};

			let index = 0;
			const workers = Math.max(1, Math.min(scanOptions.readConcurrency, 2));
			const worker = async (): Promise<void> => {
				while (index < pathsToRead.length) {
					if (cancelled(scanOptions.token)) {
						return;
					}
					const i = index++;
					const path = pathsToRead[i];
					if (!path) {
						return;
					}
					await processPath(path);
				}
			};
			await Promise.all(Array.from({ length: workers }, () => worker()));

			if (!cancelled(scanOptions.token)) {
				for (const plan of plans) {
					const updatedPathHits = pending.get(plan.cacheKey) ?? new Map<string, BodyHit[]>();
					const hits = capHitsByNoteCount(
						mergeUpdatedPathHits(plan.existingHits, updatedPathHits, scopePaths),
						scanOptions.maxCandidateNotes,
					);
					const planFailedPaths =
						failedPathsByCacheKey.get(plan.cacheKey) ?? new Set<string>();
					const scannedGeneration = generationBeforeFailures(
						this.cache.manifest,
						currentGeneration,
						plan.scannedGeneration,
						planFailedPaths,
					);
					if (plan.hadCache) {
						this.cache.updateEntry(plan.cacheKey, {
							hits,
							scannedGeneration,
						});
					} else {
						this.cache.set(plan.cacheKey, {
							hits,
							scopeFingerprint: scopeFp,
							caseSensitive: plan.caseSensitive,
							scannedGeneration,
						});
					}
					const warm = plan.pathsToScan.size === 0;
					if (!warm) {
						allWarm = false;
					}
					if (plan.pathsToScan.size > 0 && plan.pathsToScan.size < scopePaths.size) {
						anyPartial = true;
					}
					byTerm.set(plan.key, { key: plan.key, query: plan.query, hits, warm });
				}
			} else {
				for (const plan of plans) {
					const warm = plan.pathsToScan.size === 0;
					if (!warm) {
						allWarm = false;
					}
					byTerm.set(plan.key, {
						key: plan.key,
						query: plan.query,
						hits: capHitsByNoteCount(plan.existingHits, scanOptions.maxCandidateNotes),
						warm,
					});
				}
				anyPartial = true;
			}

			for (const term of terms) {
				if (!byTerm.has(term.key)) {
					byTerm.set(term.key, { key: term.key, query: term.query, hits: [], warm: true });
				}
			}

			return {
				byTerm,
				filesRead,
				readPaths,
				readCountByPath,
				currentGeneration,
				allWarm,
				anyPartial,
			};
		} finally {
			this.cache.unpinActiveKeys(pinnedKeys);
		}
	}
}
