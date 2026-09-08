import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capHitsByNoteCount } from './hitLimits.ts';
import type { BodyHit } from './types.ts';

function hit(path: string, offset: number): BodyHit {
	return { path, heading: '', offset, excerpt: 'x', mtime: 1 };
}

test('maxCandidateNotes limits unique note paths not hit count', () => {
	const hits = [
		...Array.from({ length: 8 }, (_, i) => hit('a.md', i)),
		hit('b.md', 0),
		hit('c.md', 0),
	];
	const capped = capHitsByNoteCount(hits, 2);
	const paths = new Set(capped.map((h) => h.path));
	assert.equal(paths.size, 2);
	assert.ok(paths.has('a.md'));
	assert.ok(paths.has('b.md'));
	assert.equal(capped.filter((h) => h.path === 'a.md').length, 8);
});

test('maxCandidateNotes zero returns empty', () => {
	assert.deepEqual(capHitsByNoteCount([hit('a.md', 0)], 0), []);
});

test('cap preserves path order and every hit for each kept note', () => {
	const capped = capHitsByNoteCount(
		[hit('c.md', 1), hit('a.md', 2), hit('b.md', 4), hit('a.md', 1), hit('b.md', 3)],
		2,
	);
	assert.deepEqual(
		capped.map(({ path, offset }) => ({ path, offset })),
		[
			{ path: 'a.md', offset: 2 },
			{ path: 'a.md', offset: 1 },
			{ path: 'b.md', offset: 4 },
			{ path: 'b.md', offset: 3 },
		],
	);
});
