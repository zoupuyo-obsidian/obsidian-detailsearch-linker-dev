import type { BodyHit } from '../search/types';
import { normalizeQueryKey } from '../search/bodyScanner';
import { ManifestStore, type VaultManifest } from './manifestStore';

export interface CacheEntry {
	key: string;
	hits: BodyHit[];
	lastAccess: number;
	scopeFingerprint: string;
	caseSensitive: boolean;
	scannedGeneration: number;
}

export interface PersistentCachePayload {
	version: number;
	manifest: VaultManifest;
	entries: CacheEntry[];
}

export interface CacheSnapshot {
	revision: number;
	payload: PersistentCachePayload;
}

export async function saveQueryCacheSnapshot(
	cache: QueryCache,
	save: (payload: PersistentCachePayload) => Promise<void>,
): Promise<void> {
	const snapshot = cache.createSnapshot();
	await save(snapshot.payload);
	cache.markClean(snapshot.revision);
}

export const CACHE_VERSION = 2;

/** Persistent hits keep location metadata only. Excerpts stay in memory. */
export function persistableHit(hit: BodyHit): BodyHit {
	return {
		path: hit.path,
		heading: hit.heading,
		offset: hit.offset,
		excerpt: '',
		mtime: hit.mtime,
	};
}
export const LRU_EVICT_RATIO = 0.9;

export interface QueryCacheOptions {
	mode: 'memory' | 'persistent';
	maxBytes: number;
}

export class QueryCache {
	private entries = new Map<string, CacheEntry>();
	private readonly nonPersistentKeys = new Set<string>();
	readonly manifest = new ManifestStore();
	activeKey: string | null = null;
	private activeKeys = new Set<string>();
	private revision = 0;
	private cleanRevision = 0;

	constructor(private options: QueryCacheOptions) {}

	makeKey(query: string, caseSensitive: boolean, scopeFingerprint: string): string {
		return `${normalizeQueryKey(query, caseSensitive)}\0${caseSensitive ? '1' : '0'}\0${scopeFingerprint}`;
	}

	load(payload: PersistentCachePayload | null | undefined): void {
		this.entries.clear();
		this.nonPersistentKeys.clear();
		this.revision = 0;
		this.cleanRevision = 0;
		if (!payload || payload.version !== CACHE_VERSION) {
			this.manifest.load(null);
			return;
		}
		this.manifest.load(payload.manifest);
		for (const entry of payload.entries ?? []) {
			if (entry?.key && Array.isArray(entry.hits)) {
				this.entries.set(entry.key, {
					...entry,
					hits: entry.hits.map(persistableHit),
					lastAccess: entry.lastAccess ?? 0,
					scannedGeneration: entry.scannedGeneration ?? 0,
				});
			}
		}
		this.refreshNonPersistentFlags();
	}

	exportPayload(): PersistentCachePayload {
		return {
			version: CACHE_VERSION,
			manifest: this.manifest.exportData(),
			entries: [...this.entries.values()]
				.filter((entry) => !this.nonPersistentKeys.has(entry.key))
				.map((entry) => ({
					...entry,
					hits: entry.hits.map(persistableHit),
				})),
		};
	}

	createSnapshot(): CacheSnapshot {
		return {
			revision: this.revision,
			payload: this.exportPayload(),
		};
	}

	get(key: string): CacheEntry | undefined {
		const entry = this.entries.get(key);
		if (entry) {
			entry.lastAccess = Date.now();
			if (this.options.mode === 'persistent') {
				this.markDirty();
			}
		}
		return entry;
	}

	set(
		key: string,
		entry: Omit<CacheEntry, 'key' | 'lastAccess'> & { lastAccess?: number },
	): void {
		const full: CacheEntry = {
			key,
			hits: entry.hits,
			lastAccess: entry.lastAccess ?? Date.now(),
			scopeFingerprint: entry.scopeFingerprint,
			caseSensitive: entry.caseSensitive,
			scannedGeneration: entry.scannedGeneration,
		};
		this.entries.set(key, full);
		this.markDirty();
		this.refreshEntryPersistence(key);
		this.enforceLimits(key);
	}

	updateEntry(
		key: string,
		patch: Partial<Pick<CacheEntry, 'hits' | 'scannedGeneration' | 'lastAccess'>>,
	): void {
		const entry = this.entries.get(key);
		if (!entry) {
			return;
		}
		if (patch.hits !== undefined) {
			entry.hits = patch.hits;
		}
		if (patch.scannedGeneration !== undefined) {
			entry.scannedGeneration = patch.scannedGeneration;
		}
		entry.lastAccess = patch.lastAccess ?? Date.now();
		this.markDirty();
		this.refreshEntryPersistence(key);
		this.enforceLimits(key);
	}

	touch(key: string): void {
		const entry = this.entries.get(key);
		if (entry) {
			entry.lastAccess = Date.now();
			this.markDirty();
		}
	}

	pinActive(key: string): void {
		this.activeKeys.add(key);
		if (this.activeKey === null) {
			this.activeKey = key;
		}
	}

	unpinActive(key: string): void {
		this.activeKeys.delete(key);
		if (this.activeKey === key) {
			this.activeKey = this.activeKeys.size > 0 ? [...this.activeKeys][0] ?? null : null;
		}
		this.enforceLimits();
	}

	pinActiveKeys(keys: readonly string[]): void {
		for (const key of keys) {
			this.activeKeys.add(key);
		}
		if (keys.length > 0 && this.activeKey === null) {
			this.activeKey = keys[0] ?? null;
		}
	}

	unpinActiveKeys(keys: readonly string[]): void {
		for (const key of keys) {
			this.activeKeys.delete(key);
		}
		if (this.activeKey && !this.activeKeys.has(this.activeKey)) {
			this.activeKey = this.activeKeys.size > 0 ? [...this.activeKeys][0] ?? null : null;
		}
		this.enforceLimits();
	}

	getActiveKeys(): ReadonlySet<string> {
		return this.activeKeys;
	}

	isActiveKey(key: string): boolean {
		return this.activeKeys.has(key) || this.activeKey === key;
	}

	delete(key: string): void {
		if (this.entries.delete(key)) {
			this.nonPersistentKeys.delete(key);
			this.markDirty();
		}
	}

	clear(): void {
		this.entries.clear();
		this.nonPersistentKeys.clear();
		this.markDirty();
	}

	isDirty(): boolean {
		return this.revision > this.cleanRevision;
	}

	markDirty(): void {
		this.revision++;
	}

	markClean(revision = this.revision): void {
		this.cleanRevision = Math.max(
			this.cleanRevision,
			Math.min(revision, this.revision),
		);
	}

	isNonPersistent(key: string): boolean {
		return this.nonPersistentKeys.has(key);
	}

	estimateBytes(): number {
		let size = 0;
		for (const entry of this.entries.values()) {
			size += this.estimateEntry(entry);
		}
		return size;
	}

	estimatePersistentBytes(): number {
		let size = 0;
		for (const entry of this.entries.values()) {
			if (!this.nonPersistentKeys.has(entry.key)) {
				size += this.estimateEntry(entry);
			}
		}
		return size;
	}

	entryCount(): number {
		return this.entries.size;
	}

	private estimateEntry(entry: CacheEntry): number {
		let size = entry.key.length * 2 + 48;
		for (const hit of entry.hits) {
			size += (hit.path.length + hit.heading.length) * 2 + 32;
		}
		return size;
	}

	private refreshNonPersistentFlags(): void {
		this.nonPersistentKeys.clear();
		for (const key of this.entries.keys()) {
			this.refreshEntryPersistence(key);
		}
	}

	private refreshEntryPersistence(key: string): void {
		const entry = this.entries.get(key);
		if (!entry) {
			return;
		}
		const maxBytes = this.options.maxBytes;
		if (maxBytes > 0 && this.estimateEntry(entry) > maxBytes) {
			this.nonPersistentKeys.add(key);
		} else {
			this.nonPersistentKeys.delete(key);
		}
	}

	private enforceLimits(protectKey?: string): void {
		const maxBytes = this.options.maxBytes;
		if (maxBytes <= 0) {
			return;
		}
		if (this.estimatePersistentBytes() <= maxBytes) {
			return;
		}
		this.evictLru(maxBytes * LRU_EVICT_RATIO, protectKey);
	}

	evictLru(targetBytes: number, protectKey?: string): number {
		if (this.estimatePersistentBytes() <= targetBytes) {
			return 0;
		}
		const protectedKeys = new Set(this.activeKeys);
		if (protectKey) {
			protectedKeys.add(protectKey);
		}
		if (this.activeKey) {
			protectedKeys.add(this.activeKey);
		}
		const sorted = [...this.entries.entries()]
			.filter(
				([k]) =>
					!protectedKeys.has(k) &&
					!this.nonPersistentKeys.has(k),
			)
			.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
		let evicted = 0;
		for (const [key] of sorted) {
			if (this.estimatePersistentBytes() <= targetBytes) {
				break;
			}
			this.entries.delete(key);
			this.nonPersistentKeys.delete(key);
			evicted++;
			this.markDirty();
		}
		return evicted;
	}

	setOptions(options: QueryCacheOptions): void {
		this.options = options;
		this.refreshNonPersistentFlags();
		this.enforceLimits(this.activeKey ?? undefined);
	}

	clearActivePins(): void {
		this.activeKeys.clear();
		this.activeKey = null;
	}
}
