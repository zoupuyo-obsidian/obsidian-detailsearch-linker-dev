import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterScopeFiles, pathInFolders, scopeFingerprint } from './search/scopeFilter.ts';

test('pathInFolders include/exclude', () => {
	assert.equal(pathInFolders('notes/a.md', ['notes'], ['notes/private']), true);
	assert.equal(pathInFolders('notes/private/x.md', ['notes'], ['notes/private']), false);
	assert.equal(pathInFolders('other/x.md', ['notes'], []), false);
});

test('filterScopeFiles excludes self and applies limits', () => {
	const files = [
		{ path: 'a.md', statMtime: 100, size: 100 },
		{ path: 'b.md', statMtime: 200, size: 100 },
		{ path: 'd.md', statMtime: 150, size: 100 },
		{ path: 'c.md', statMtime: 300, size: 999_999 },
	];
	const result = filterScopeFiles(
		files,
		{
			includeFolders: [],
			excludeFolders: [],
			scopeMode: 'all',
			recentDays: 0,
			worksetPaths: [],
			maxFiles: 1,
			maxFileBytes: 500_000,
		},
		'a.md',
	);
	assert.equal(result.files.length, 1);
	assert.equal(result.files[0]!.path, 'b.md');
	assert.equal(result.skippedBySize, 1);
	assert.equal(result.skippedByLimit, 1);
});

test('recent scope filters by mtime', () => {
	const now = Date.now();
	const files = [
		{ path: 'old.md', statMtime: now - 40 * 86_400_000, size: 10 },
		{ path: 'new.md', statMtime: now - 1 * 86_400_000, size: 10 },
	];
	const result = filterScopeFiles(
		files,
		{
			includeFolders: [],
			excludeFolders: [],
			scopeMode: 'recent',
			recentDays: 7,
			worksetPaths: [],
			maxFiles: 500,
			maxFileBytes: 500_000,
		},
		'x.md',
		now,
	);
	assert.deepEqual(
		result.files.map((f) => f.path),
		['new.md'],
	);
});

test('scope fingerprint changes with settings', () => {
	const a = scopeFingerprint({
		includeFolders: ['a'],
		excludeFolders: [],
		scopeMode: 'all',
		recentDays: 30,
		worksetPaths: [],
		maxFiles: 100,
		maxFileBytes: 1000,
	});
	const b = scopeFingerprint({
		includeFolders: ['b'],
		excludeFolders: [],
		scopeMode: 'all',
		recentDays: 30,
		worksetPaths: [],
		maxFiles: 100,
		maxFileBytes: 1000,
	});
	assert.notEqual(a, b);
});
