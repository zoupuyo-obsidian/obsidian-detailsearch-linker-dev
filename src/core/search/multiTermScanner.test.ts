import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BODY_CHUNK_SIZE } from './types.ts';
import { scanFileMultiTermsAsync } from './multiTermScanner.ts';

test('mixed case-sensitive and insensitive terms scan correctly', async () => {
	const content = 'Hello HELLO hello';
	const result = await scanFileMultiTermsAsync(
		{ path: 'n.md', content, mtime: 1 },
		[
			{ key: 'sensitive', query: 'Hello', caseSensitive: true },
			{ key: 'insensitive', query: 'hello', caseSensitive: false },
		],
		{ excerptLength: 40, maxHitsPerNote: 10 },
	);
	assert.equal(result.get('sensitive')!.length, 1);
	assert.equal(result.get('insensitive')!.length, 3);
});

test('case-sensitive term does not match different case when mixed batch', async () => {
	const content = 'hello only lower';
	const result = await scanFileMultiTermsAsync(
		{ path: 'n.md', content, mtime: 1 },
		[
			{ key: 'sensitive', query: 'Hello', caseSensitive: true },
			{ key: 'insensitive', query: 'hello', caseSensitive: false },
		],
		{ excerptLength: 40, maxHitsPerNote: 10 },
	);
	assert.equal(result.get('sensitive')!.length, 0);
	assert.equal(result.get('insensitive')!.length, 1);
});

test('insensitive batch scan preserves offsets after expanded case folds', async () => {
	const content = 'İ target';
	const result = await scanFileMultiTermsAsync(
		{ path: 'unicode.md', content, mtime: 1 },
		[{ key: 'target', query: 'target', caseSensitive: false }],
		{ excerptLength: 40, maxHitsPerNote: 10 },
	);

	assert.equal(result.get('target')!.length, 1);
	assert.equal(result.get('target')![0]!.offset, content.indexOf('target'));
});

test('insensitive batch scan handles expansion and surrogate chunk boundaries', async () => {
	const prefix = ' '.repeat(BODY_CHUNK_SIZE - 1);
	const content = `${prefix}i\u0307 😀`;
	const result = await scanFileMultiTermsAsync(
		{ path: 'unicode.md', content, mtime: 1 },
		[
			{ key: 'expanded', query: 'İ', caseSensitive: false },
			{ key: 'surrogate', query: '😀', caseSensitive: false },
		],
		{ excerptLength: 40, maxHitsPerNote: 10 },
	);

	assert.equal(result.get('expanded')![0]!.offset, prefix.length);
	assert.equal(result.get('surrogate')![0]!.offset, content.indexOf('😀'));
});
