import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryCache } from './cache/queryCache.ts';
import { SearchCoordinator } from './search/searchCoordinator.ts';
import { scopeFingerprint, type ScopedFile } from './search/scopeFilter.ts';

const SCOPE = {
	includeFolders: [] as string[],
	excludeFolders: [] as string[],
	scopeMode: 'all' as const,
	recentDays: 0,
	worksetPaths: [] as string[],
	maxFiles: 500,
	maxFileBytes: 2_000_000,
};

const REQUEST = {
	query: 'term',
	displayText: 'term',
	source: 'selection' as const,
	anchorFrom: 0,
	anchorTo: 4,
	caseSensitive: false,
	canLink: true,
};

type FileRecord = { content: string; mtime: number };

function makeHarness(initial: Record<string, FileRecord>) {
	const files = new Map(Object.entries(initial));
	const readPaths: string[] = [];
	const failedPaths = new Set<string>();
	const cache = new QueryCache({ mode: 'persistent', maxBytes: 1024 * 1024 });
	const coordinator = new SearchCoordinator(cache, async (path) => {
		readPaths.push(path);
		if (failedPaths.has(path)) {
			return null;
		}
		const rec = files.get(path);
		if (!rec) {
			return null;
		}
		return { content: rec.content, mtime: rec.mtime };
	});

	const scoped = (paths: string[]): ScopedFile[] =>
		paths.map((path) => {
			const rec = files.get(path)!;
			return { path, statMtime: rec.mtime, size: rec.content.length };
		});

	const run = async (paths: string[]) =>
		coordinator.execute({
			request: REQUEST,
			scopeSettings: SCOPE,
			scopedFiles: scoped(paths),
			scanOptions: {
				excerptLength: 80,
				maxHitsPerNote: 10,
				maxCandidateNotes: 50,
				readConcurrency: 1,
				yieldFn: async () => undefined,
			},
		});

	return {
		cache,
		coordinator,
		files,
		failedPaths,
		readPaths,
		scoped,
		run,
		set(path: string, content: string, mtime: number) {
			files.set(path, { content, mtime });
		},
		fail(path: string) {
			failedPaths.add(path);
		},
		recover(path: string) {
			failedPaths.delete(path);
		},
	};
}

test('(a) warm query rescans only changed non-match file that gained a hit', async () => {
	const h = makeHarness({
		'a.md': { content: 'term here', mtime: 1 },
		'b.md': { content: 'nothing', mtime: 1 },
	});
	const cold = await h.run(['a.md', 'b.md']);
	assert.equal(cold.filesRead, 2);
	assert.deepEqual(cold.readPaths.sort(), ['a.md', 'b.md']);
	assert.equal(cold.hits.length, 1);
	assert.equal(cold.hits[0]!.path, 'a.md');

	h.set('b.md', 'now has term inside', 2);
	h.readPaths.length = 0;
	const warm = await h.run(['a.md', 'b.md']);
	assert.equal(warm.filesRead, 1);
	assert.deepEqual(warm.readPaths, ['b.md']);
	assert.equal(warm.hits.length, 2);
	assert.ok(warm.hits.some((hit) => hit.path === 'b.md'));
});

test('(b) warm query rescans changed matching file and updates hits', async () => {
	const h = makeHarness({
		'a.md': { content: 'term old', mtime: 1 },
	});
	await h.run(['a.md']);
	h.set('a.md', 'term new version', 2);
	h.readPaths.length = 0;
	const warm = await h.run(['a.md']);
	assert.equal(warm.filesRead, 1);
	assert.deepEqual(warm.readPaths, ['a.md']);
	assert.equal(warm.hits.length, 1);
	assert.ok(warm.hits[0]!.excerpt.includes('new'));
});

test('(c) offline mtime drift reconciled and only changed file is read', async () => {
	const h = makeHarness({
		'a.md': { content: 'term', mtime: 1 },
		'b.md': { content: 'term', mtime: 1 },
	});
	await h.run(['a.md', 'b.md']);
	// Simulate Obsidian stopped: manifest keeps old mtime while vault changed.
	h.cache.manifest.load({
		generation: h.cache.manifest.getGeneration(),
		files: {
			'a.md': { mtime: 1, lastChangedGeneration: 1 },
			'b.md': { mtime: 1, lastChangedGeneration: 1 },
		},
	});
	h.set('b.md', 'term updated offline', 99);
	h.readPaths.length = 0;
	const warm = await h.run(['a.md', 'b.md']);
	assert.equal(warm.filesRead, 1);
	assert.deepEqual(warm.readPaths, ['b.md']);
});

test('(d) new rename delete paths handled on warm search', async () => {
	const h = makeHarness({
		'a.md': { content: 'term', mtime: 1 },
		'old.md': { content: 'term', mtime: 1 },
	});
	await h.run(['a.md', 'old.md']);
	h.cache.manifest.noteRenamed('old.md', 'new.md', 2);
	h.files.delete('old.md');
	h.set('new.md', 'term renamed', 2);
	h.set('fresh.md', 'term fresh', 3);
	h.readPaths.length = 0;
	const warm = await h.run(['a.md', 'new.md', 'fresh.md']);
	assert.deepEqual(warm.readPaths.sort(), ['fresh.md', 'new.md']);
	assert.ok(!warm.hits.some((hit) => hit.path === 'old.md'));
	assert.ok(warm.hits.some((hit) => hit.path === 'new.md'));
	assert.ok(warm.hits.some((hit) => hit.path === 'fresh.md'));
});

test('(e) cached hits outside current scope are not returned', async () => {
	const h = makeHarness({
		'a.md': { content: 'term', mtime: 1 },
		'b.md': { content: 'term', mtime: 1 },
	});
	await h.run(['a.md', 'b.md']);
	h.readPaths.length = 0;
	const warm = await h.run(['a.md']);
	assert.equal(warm.filesRead, 0);
	assert.deepEqual(warm.readPaths, []);
	assert.equal(warm.hits.length, 1);
	assert.equal(warm.hits[0]!.path, 'a.md');
});

test('(f) fully warm search performs zero body reads', async () => {
	const h = makeHarness({
		'a.md': { content: 'term', mtime: 1 },
		'b.md': { content: 'term', mtime: 1 },
	});
	await h.run(['a.md', 'b.md']);
	h.readPaths.length = 0;
	const warm = await h.run(['a.md', 'b.md']);
	assert.equal(warm.warm, true);
	assert.equal(warm.filesRead, 0);
	assert.deepEqual(warm.readPaths, []);
	assert.equal(warm.hits.length, 2);
});

test('(g) cold cancel mid-scan writes no cache entry and retries unscanned paths', async () => {
	const h = makeHarness({
		'a.md': { content: 'term', mtime: 1 },
		'b.md': { content: 'term', mtime: 1 },
		'c.md': { content: 'term', mtime: 1 },
	});
	const token = { cancelled: false };
	let reads = 0;
	const cache = new QueryCache({ mode: 'persistent', maxBytes: 1024 * 1024 });
	const coordinator = new SearchCoordinator(cache, async (path) => {
		reads++;
		if (reads >= 2) {
			token.cancelled = true;
		}
		const rec = h.files.get(path);
		return rec ? { content: rec.content, mtime: rec.mtime } : null;
	});
	const scoped = h.scoped(['a.md', 'b.md', 'c.md']);
	const scanOptions = {
		excerptLength: 80,
		maxHitsPerNote: 10,
		maxCandidateNotes: 50,
		readConcurrency: 1,
		token,
		yieldFn: async () => undefined,
	};
	await coordinator.execute({
		request: REQUEST,
		scopeSettings: SCOPE,
		scopedFiles: scoped,
		scanOptions,
	});
	const key = cache.makeKey('term', false, scopeFingerprint(SCOPE));
	assert.equal(cache.get(key), undefined);
	reads = 0;
	const retry = await coordinator.execute({
		request: REQUEST,
		scopeSettings: SCOPE,
		scopedFiles: scoped,
		scanOptions: { ...scanOptions, token: undefined },
	});
	assert.equal(reads, 3);
	assert.equal(retry.hits.length, 3);
	assert.ok(cache.get(key));
});

test('(h) warm cancel mid-rescan leaves cache generation and hits unchanged', async () => {
	const h = makeHarness({
		'a.md': { content: 'term', mtime: 1 },
		'b.md': { content: 'term', mtime: 1 },
	});
	await h.run(['a.md', 'b.md']);
	const key = h.cache.makeKey('term', false, scopeFingerprint(SCOPE));
	const before = h.cache.get(key)!;
	const beforeGen = before.scannedGeneration;
	const beforeHitsJson = JSON.stringify(before.hits);
	h.set('b.md', 'term updated text', 2);
	const token = { cancelled: false };
	let reads = 0;
	const coordinator = new SearchCoordinator(h.cache, async (path) => {
		reads++;
		token.cancelled = true;
		const rec = h.files.get(path);
		return rec ? { content: rec.content, mtime: rec.mtime } : null;
	});
	await coordinator.execute({
		request: REQUEST,
		scopeSettings: SCOPE,
		scopedFiles: h.scoped(['a.md', 'b.md']),
		scanOptions: {
			excerptLength: 80,
			maxHitsPerNote: 10,
			maxCandidateNotes: 50,
			readConcurrency: 1,
			token,
			yieldFn: async () => undefined,
		},
	});
	const after = h.cache.get(key)!;
	assert.equal(after.scannedGeneration, beforeGen);
	assert.equal(JSON.stringify(after.hits), beforeHitsJson);
	reads = 0;
	const retry = await coordinator.execute({
		request: REQUEST,
		scopeSettings: SCOPE,
		scopedFiles: h.scoped(['a.md', 'b.md']),
		scanOptions: {
			excerptLength: 80,
			maxHitsPerNote: 10,
			maxCandidateNotes: 50,
			readConcurrency: 1,
			yieldFn: async () => undefined,
		},
	});
	assert.equal(reads, 1);
	assert.deepEqual(retry.readPaths, ['b.md']);
	assert.ok(retry.hits.some((hit) => hit.excerpt.includes('updated')));
});

test('cold read failure remains incomplete and retries successfully', async () => {
	const h = makeHarness({
		'a.md': { content: 'term found after retry', mtime: 1 },
	});
	h.fail('a.md');
	const first = await h.run(['a.md']);
	const key = h.cache.makeKey('term', false, scopeFingerprint(SCOPE));
	const incomplete = h.cache.get(key)!;

	assert.equal(first.hits.length, 0);
	assert.ok(incomplete.scannedGeneration < h.cache.manifest.getGeneration());

	h.recover('a.md');
	h.readPaths.length = 0;
	const retry = await h.run(['a.md']);
	assert.deepEqual(h.readPaths, ['a.md']);
	assert.equal(retry.hits.length, 1);
	assert.equal(h.cache.get(key)!.scannedGeneration, h.cache.manifest.getGeneration());
});

test('warm read failure preserves cached hit and retries changed path', async () => {
	const h = makeHarness({
		'a.md': { content: 'term original', mtime: 1 },
	});
	await h.run(['a.md']);
	const key = h.cache.makeKey('term', false, scopeFingerprint(SCOPE));
	const previousGeneration = h.cache.get(key)!.scannedGeneration;

	h.set('a.md', 'term restored after failure', 2);
	h.fail('a.md');
	const failed = await h.run(['a.md']);
	assert.equal(failed.hits.length, 1);
	assert.ok(failed.hits[0]!.excerpt.includes('original'));
	assert.equal(h.cache.get(key)!.scannedGeneration, previousGeneration);

	h.recover('a.md');
	h.readPaths.length = 0;
	const retry = await h.run(['a.md']);
	assert.deepEqual(h.readPaths, ['a.md']);
	assert.ok(retry.hits[0]!.excerpt.includes('restored'));
});
