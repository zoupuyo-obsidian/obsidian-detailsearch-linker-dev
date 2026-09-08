import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchRunIsCurrent, type SearchRunSnapshot } from './searchRunGuard.ts';

const snapshot: SearchRunSnapshot = {
	runId: 4,
	filePath: 'source.md',
	text: 'original text',
};

test('search run remains current only for the same editor snapshot', () => {
	assert.equal(searchRunIsCurrent(snapshot, { ...snapshot, sameEditor: true }), true);
});

test('search run becomes stale after file switch, edit, or invalidation', () => {
	assert.equal(
		searchRunIsCurrent(snapshot, {
			...snapshot,
			filePath: 'other.md',
			sameEditor: true,
		}),
		false,
	);
	assert.equal(
		searchRunIsCurrent(snapshot, {
			...snapshot,
			text: 'edited text',
			sameEditor: true,
		}),
		false,
	);
	assert.equal(
		searchRunIsCurrent(snapshot, {
			...snapshot,
			runId: 5,
			sameEditor: true,
		}),
		false,
	);
	assert.equal(
		searchRunIsCurrent(snapshot, { ...snapshot, sameEditor: false }),
		false,
	);
});
