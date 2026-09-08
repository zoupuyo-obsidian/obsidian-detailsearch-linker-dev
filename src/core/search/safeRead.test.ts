import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeRead } from './safeRead.ts';

test('safeRead returns successful values', async () => {
	const result = await safeRead('ok.md', async () => 'content', () => {
		assert.fail('onError must not be called');
	});
	assert.equal(result, 'content');
});

test('safeRead reports and isolates read failures', async () => {
	const expected = new Error('read failed');
	let reported: { path: string; error: unknown } | null = null;
	const result = await safeRead(
		'broken.md',
		async () => {
			throw expected;
		},
		(path, error) => {
			reported = { path, error };
		},
	);

	assert.equal(result, null);
	assert.deepEqual(reported, { path: 'broken.md', error: expected });
});
