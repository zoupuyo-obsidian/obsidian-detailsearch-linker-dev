import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterNonOverlappingMarks, prepareHighlightRanges } from './highlightRanges.ts';

test('prepareHighlightRanges drops overlapping marks safely', () => {
	const items = [
		{ from: 0, to: 10, kind: 'mark' as const, sortOrder: 0 },
		{ from: 10, to: 10, kind: 'widget' as const, sortOrder: 1 },
		{ from: 5, to: 15, kind: 'mark' as const, sortOrder: 0 },
	];
	const safe = prepareHighlightRanges(items);
	assert.equal(safe.filter((i) => i.kind === 'mark').length, 1);
	assert.ok(safe.some((i) => i.kind === 'widget'));
});

test('filterNonOverlappingMarks sorts by from before filtering', () => {
	const items = [
		{ from: 5, to: 15, kind: 'mark' as const, sortOrder: 0 },
		{ from: 0, to: 10, kind: 'mark' as const, sortOrder: 0 },
	];
	const safe = filterNonOverlappingMarks(items);
	assert.deepEqual(
		safe.map((i) => i.from),
		[0],
	);
});

test('overlapping mark input does not throw when building sorted ranges', () => {
	assert.doesNotThrow(() => {
		prepareHighlightRanges([
			{ from: 0, to: 20, kind: 'mark', sortOrder: 0 },
			{ from: 2, to: 8, kind: 'mark', sortOrder: 0 },
			{ from: 8, to: 8, kind: 'widget', sortOrder: 1 },
		]);
	});
});
