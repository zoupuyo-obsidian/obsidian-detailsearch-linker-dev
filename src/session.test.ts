import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildAutoSession,
	buildSelectionSession,
	getGroup,
	groupCandidateCount,
	groupHitsToCandidates,
	sessionStats,
	type ResultGroup,
	type SessionAnchor,
} from './session.ts';
import type { BodyHit } from './core/search/types.ts';

function hit(path: string, offset: number): BodyHit {
	return {
		path,
		offset,
		length: 4,
		excerpt: 'term',
		heading: '',
	};
}

test('selection session has single group shared by anchors', () => {
	const group: ResultGroup = {
		key: 'term',
		query: 'term',
		displayText: 'term',
		canLink: true,
		candidates: groupHitsToCandidates([hit('a.md', 0)], () => ({ stem: 'a', title: 'A' })),
	};
	const anchors: SessionAnchor[] = [
		{ id: '1', from: 0, to: 4, text: 'term', groupKey: 'term' },
		{ id: '2', from: 10, to: 14, text: 'term', groupKey: 'term' },
	];
	const session = buildSelectionSession({
		filePath: 'note.md',
		group,
		anchors,
		style: 'invert',
		showBadge: true,
		caseSensitive: false,
	});
	assert.equal(session.mode, 'selection');
	assert.equal(session.groups.length, 1);
	assert.equal(groupCandidateCount(session, 'term'), 1);
});

test('auto session isolates candidate groups per query', () => {
	const groupA: ResultGroup = {
		key: 'alpha',
		query: 'alpha',
		displayText: 'alpha',
		canLink: true,
		candidates: groupHitsToCandidates([hit('x.md', 0)], () => ({ stem: 'x', title: 'X' })),
	};
	const groupB: ResultGroup = {
		key: 'beta',
		query: 'beta',
		displayText: 'beta',
		canLink: true,
		candidates: groupHitsToCandidates([hit('y.md', 0)], () => ({ stem: 'y', title: 'Y' })),
	};
	const session = buildAutoSession({
		filePath: 'note.md',
		groups: [groupA, groupB],
		anchors: [
			{ id: 'a1', from: 0, to: 5, text: 'alpha', groupKey: 'alpha' },
			{ id: 'b1', from: 20, to: 24, text: 'beta', groupKey: 'beta' },
		],
		style: 'marker',
		showBadge: true,
		caseSensitive: true,
	});
	assert.equal(getGroup(session, 'alpha')!.candidates[0]!.path, 'x.md');
	assert.equal(getGroup(session, 'beta')!.candidates[0]!.path, 'y.md');
	assert.notEqual(
		getGroup(session, 'alpha')!.candidates[0]!.path,
		getGroup(session, 'beta')!.candidates[0]!.path,
	);
	const stats = sessionStats(session);
	assert.equal(stats.linkedTermCount, 2);
	assert.equal(stats.candidateNoteCount, 2);
});
