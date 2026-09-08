import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupeOverlappingAnchors } from './anchorDedupe.ts';

test('dedupe keeps higher score anchor when ranges overlap', () => {
	const kept = dedupeOverlappingAnchors([
		{ from: 0, to: 20, text: 'long phrase here', score: 500, groupKey: 'a', source: 'prose', stableIndex: 0 },
		{ from: 0, to: 6, text: 'long', score: 100, groupKey: 'b', source: 'ngram', stableIndex: 1 },
	]);
	assert.equal(kept.length, 1);
	assert.equal(kept[0]!.groupKey, 'a');
});

test('dedupe prefers longer range at equal score', () => {
	const kept = dedupeOverlappingAnchors([
		{ from: 5, to: 10, text: 'short', score: 500, groupKey: 'a', source: 'prose', stableIndex: 0 },
		{ from: 0, to: 15, text: 'much longer', score: 500, groupKey: 'b', source: 'prose', stableIndex: 1 },
	]);
	assert.equal(kept.length, 1);
	assert.equal(kept[0]!.text, 'much longer');
});

test('dedupe keeps non-overlapping anchors for same term elsewhere', () => {
	const kept = dedupeOverlappingAnchors([
		{ from: 0, to: 4, text: 'term', score: 800, groupKey: 't', source: 'emphasis', stableIndex: 0 },
		{ from: 20, to: 24, text: 'term', score: 800, groupKey: 't', source: 'emphasis', stableIndex: 1 },
	]);
	assert.equal(kept.length, 2);
});

test('emphasis beats ngram when both hit and overlap', () => {
	const kept = dedupeOverlappingAnchors([
		{ from: 0, to: 8, text: '認知負荷', score: 1200, groupKey: 'e', source: 'emphasis', stableIndex: 0 },
		{ from: 0, to: 4, text: '認知', score: 102, groupKey: 'n1', source: 'ngram', stableIndex: 1 },
		{ from: 2, to: 6, text: '知負', score: 102, groupKey: 'n2', source: 'ngram', stableIndex: 2 },
	]);
	assert.equal(kept.length, 1);
	assert.equal(kept[0]!.source, 'emphasis');
});
