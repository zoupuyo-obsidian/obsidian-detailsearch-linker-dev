import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BODY_CHUNK_SIZE } from './search/types.ts';
import {
	scanFileContent,
	scanFileContentAsync,
	scanFilesForTerm,
} from './search/bodyScanner.ts';

test('chunk boundary match with overlap', () => {
	const pad = 'x'.repeat(BODY_CHUNK_SIZE - 2);
	const term = '救急';
	const text = `${pad}${term}${'y'.repeat(100)}`;
	const hits = scanFileContent(
		{ path: 'a.md', content: text, mtime: 1 },
		{
			query: term,
			caseSensitive: false,
			excerptLength: 40,
			maxHitsPerNote: 10,
		},
	);
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.offset, pad.length);
});

test('async scan yields between chunks', async () => {
	const pad = 'a'.repeat(BODY_CHUNK_SIZE * 2);
	const text = `${pad} 救急 ${pad}`;
	let yields = 0;
	const hits = await scanFileContentAsync(
		{ path: 'a.md', content: text, mtime: 1 },
		{
			query: '救急',
			caseSensitive: false,
			excerptLength: 20,
			maxHitsPerNote: 10,
			yieldFn: async () => {
				yields++;
			},
			onChunk: () => undefined,
		},
	);
	assert.equal(hits.length, 1);
	assert.ok(yields >= 2);
});

test('async scan cancels mid-chunk walk', async () => {
	const pad = 'a'.repeat(BODY_CHUNK_SIZE * 3);
	const text = `${pad}term${pad}term${pad}`;
	const token = { cancelled: false };
	let yields = 0;
	const hits = await scanFileContentAsync(
		{ path: 'a.md', content: text, mtime: 1 },
		{
			query: 'term',
			caseSensitive: false,
			excerptLength: 20,
			maxHitsPerNote: 10,
			token,
			yieldFn: async () => {
				yields++;
				if (yields >= 2) {
					token.cancelled = true;
				}
			},
		},
	);
	assert.ok(hits.length <= 1);
	assert.ok(yields >= 2);
});

test('respects maxHitsPerNote', () => {
	const text = '救急 救急 救急 救急';
	const hits = scanFileContent(
		{ path: 'a.md', content: text, mtime: 1 },
		{
			query: '救急',
			caseSensitive: false,
			excerptLength: 20,
			maxHitsPerNote: 2,
		},
	);
	assert.equal(hits.length, 2);
});

test('skips match inside code fence', () => {
	const text = '```\n救急\n```\n救急';
	const hits = scanFileContent(
		{ path: 'a.md', content: text, mtime: 1 },
		{
			query: '救急',
			caseSensitive: false,
			excerptLength: 20,
			maxHitsPerNote: 10,
		},
	);
	assert.equal(hits.length, 1);
});

test('english case insensitive', () => {
	const text = 'Hello HELLO hello';
	const hits = scanFileContent(
		{ path: 'a.md', content: text, mtime: 1 },
		{
			query: 'hello',
			caseSensitive: false,
			excerptLength: 20,
			maxHitsPerNote: 10,
		},
	);
	assert.equal(hits.length, 3);
});

test('english case sensitive', () => {
	const text = 'Hello HELLO hello';
	const hits = scanFileContent(
		{ path: 'a.md', content: text, mtime: 1 },
		{
			query: 'Hello',
			caseSensitive: true,
			excerptLength: 20,
			maxHitsPerNote: 10,
		},
	);
	assert.equal(hits.length, 1);
});

test('case folding before a match does not shift source offsets', async () => {
	const text = 'İ target';
	const hits = await scanFileContentAsync(
		{ path: 'unicode.md', content: text, mtime: 1 },
		{
			query: 'target',
			caseSensitive: false,
			excerptLength: 40,
			maxHitsPerNote: 10,
			yieldFn: async () => undefined,
		},
	);

	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.offset, text.indexOf('target'));
});

test('expanded case fold can match across a chunk boundary', async () => {
	const prefix = ' '.repeat(BODY_CHUNK_SIZE - 1);
	const text = `${prefix}i\u0307 after`;
	const hits = await scanFileContentAsync(
		{ path: 'unicode.md', content: text, mtime: 1 },
		{
			query: 'İ',
			caseSensitive: false,
			excerptLength: 40,
			maxHitsPerNote: 10,
			yieldFn: async () => undefined,
		},
	);

	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.offset, prefix.length);
});

test('surrogate pair at a chunk boundary is not split out of a match', async () => {
	const prefix = ' '.repeat(BODY_CHUNK_SIZE - 1);
	const text = `${prefix}😀 after`;
	const hits = await scanFileContentAsync(
		{ path: 'unicode.md', content: text, mtime: 1 },
		{
			query: '😀',
			caseSensitive: false,
			excerptLength: 40,
			maxHitsPerNote: 10,
			yieldFn: async () => undefined,
		},
	);

	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.offset, prefix.length);
});

test('candidate note cap counts matching notes rather than scanned empty notes', async () => {
	const files = Array.from({ length: 81 }, (_, i) => ({
		path: `${String(i).padStart(2, '0')}.md`,
		content: '',
		mtime: 1,
	}));
	const result = await scanFilesForTerm(
		files,
		async (path) => ({
			content: path === '80.md' ? 'needle' : 'no match',
			mtime: 1,
		}),
		{
			query: 'needle',
			caseSensitive: false,
			excerptLength: 40,
			maxHitsPerNote: 8,
			maxCandidateNotes: 1,
			readConcurrency: 2,
			yieldFn: async () => undefined,
		},
	);

	assert.equal(result.filesRead, 81);
	assert.deepEqual(result.hits.map((hit) => hit.path), ['80.md']);
});
