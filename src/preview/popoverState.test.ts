import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	normalizePopoverFocus,
	resolveAdjacentAnchor,
	resolveAnchorAtPosition,
	resolveHoverSchedule,
	stepPopoverFocus,
	stepFocusableIndex,
	shouldConsumeArmedKey,
	resolvePopoverActionTarget,
} from './popoverState.ts';
import {
	buildAutoSession,
	type NoteCandidate,
	type ResultGroup,
} from '../session.ts';

function candidate(path: string, headings: string[] = ['Heading']): NoteCandidate {
	return {
		path,
		stem: path,
		title: path,
		hits: headings.map((heading, offset) => ({
			path,
			heading,
			offset,
			excerpt: heading,
			mtime: 1,
		})),
	};
}

function group(key: string, candidates: NoteCandidate[]): ResultGroup {
	return {
		key,
		query: key,
		displayText: key,
		canLink: true,
		candidates,
	};
}

test('resets focus to first candidate when new group lacks old path', () => {
	const groupB = group('b', [candidate('b-first.md'), candidate('b-second.md')]);
	assert.deepEqual(
		normalizePopoverFocus(groupB, { path: 'a-selected.md', hitIndex: 2 }),
		{ path: 'b-first.md', hitIndex: 0 },
	);
});

test('clears focus when group has no candidates', () => {
	assert.deepEqual(
		normalizePopoverFocus(group('empty', []), {
			path: 'old.md',
			hitIndex: 1,
		}),
		{ path: '', hitIndex: 0 },
	);
});

test('resolves action target and hit from fresh anchor group', () => {
	const staleGroup = group('old', [candidate('stale.md')]);
	const freshGroup = group('fresh', [
		candidate('fresh.md', ['First', 'Fresh second']),
	]);
	const session = buildAutoSession({
		filePath: 'source.md',
		groups: [staleGroup, freshGroup],
		anchors: [
			{
				id: 'same-anchor-id',
				from: 0,
				to: 5,
				text: 'fresh',
				groupKey: 'fresh',
			},
		],
		style: 'invert',
		showBadge: true,
		caseSensitive: false,
	});

	const target = resolvePopoverActionTarget(
		session,
		'same-anchor-id',
		'fresh.md',
		1,
	);
	assert.equal(target?.group.key, 'fresh');
	assert.equal(target?.candidate.path, 'fresh.md');
	assert.equal(target?.hit.heading, 'Fresh second');
	assert.equal(
		resolvePopoverActionTarget(session, 'same-anchor-id', 'stale.md', 0),
		null,
	);
});

test('keeps a pending hover timer for repeated movement on the same anchor', () => {
	assert.equal(resolveHoverSchedule('anchor-a', null, false, 'anchor-a'), 'keep');
	assert.equal(resolveHoverSchedule('anchor-a', null, false, 'anchor-b'), 'schedule');
	assert.equal(resolveHoverSchedule('anchor-a', null, false, null), 'cancel');
	assert.equal(resolveHoverSchedule(null, 'anchor-a', true, 'anchor-a'), 'cancel');
});

test('resolves cursor boundaries and chooses the smallest containing anchor', () => {
	const anchors = [
		{ id: 'wide', from: 2, to: 12, text: 'wide', groupKey: 'wide' },
		{ id: 'small-b', from: 5, to: 8, text: 'small', groupKey: 'small' },
		{ id: 'small-a', from: 5, to: 8, text: 'small', groupKey: 'small' },
	];
	assert.equal(resolveAnchorAtPosition(anchors, 2)?.id, 'wide');
	assert.equal(resolveAnchorAtPosition(anchors, 8)?.id, 'small-a');
	assert.equal(resolveAnchorAtPosition(anchors, 12)?.id, 'wide');
	assert.equal(resolveAnchorAtPosition(anchors, 13), null);
});

test('resolveAdjacentAnchor walks document order and wraps', () => {
	const anchors = [
		{ id: 'first', from: 2, to: 5, text: 'one', groupKey: 'one' },
		{ id: 'second', from: 10, to: 14, text: 'two', groupKey: 'two' },
		{ id: 'third', from: 20, to: 24, text: 'three', groupKey: 'three' },
	];
	assert.equal(resolveAdjacentAnchor([], 0, 1), null);
	assert.equal(resolveAdjacentAnchor(anchors, 3, 1)?.id, 'second');
	assert.equal(resolveAdjacentAnchor(anchors, 3, -1)?.id, 'third');
	assert.equal(resolveAdjacentAnchor(anchors, 7, 1)?.id, 'second');
	assert.equal(resolveAdjacentAnchor(anchors, 7, -1)?.id, 'first');
	assert.equal(resolveAdjacentAnchor(anchors, 30, 1)?.id, 'first');
	assert.equal(resolveAdjacentAnchor(anchors, 0, -1)?.id, 'third');
	assert.equal(resolveAdjacentAnchor(anchors, 22, 1)?.id, 'first');
});

test('stepPopoverFocus wraps candidates and hits', () => {
	const notes = group('g', [
		candidate('a.md', ['A1', 'A2']),
		candidate('b.md', ['B1']),
	]);
	assert.deepEqual(
		stepPopoverFocus(notes, { path: 'a.md', hitIndex: 0 }, 'candidate', 1),
		{ path: 'b.md', hitIndex: 0 },
	);
	assert.deepEqual(
		stepPopoverFocus(notes, { path: 'a.md', hitIndex: 0 }, 'candidate', -1),
		{ path: 'b.md', hitIndex: 0 },
	);
	assert.deepEqual(
		stepPopoverFocus(notes, { path: 'a.md', hitIndex: 0 }, 'hit', 1),
		{ path: 'a.md', hitIndex: 1 },
	);
	assert.deepEqual(
		stepPopoverFocus(notes, { path: 'a.md', hitIndex: 1 }, 'hit', 1),
		{ path: 'a.md', hitIndex: 0 },
	);
});

test('shouldConsumeArmedKey blocks typing and IME while allowing popover buttons', () => {
	assert.equal(shouldConsumeArmedKey('a'), true);
	assert.equal(shouldConsumeArmedKey('あ'), true);
	assert.equal(shouldConsumeArmedKey('Backspace'), true);
	assert.equal(shouldConsumeArmedKey('ArrowDown'), true);
	assert.equal(shouldConsumeArmedKey('Process', { isComposing: true }), true);
	assert.equal(
		shouldConsumeArmedKey('Enter', { targetInsidePopover: false }),
		true,
	);
	assert.equal(
		shouldConsumeArmedKey('Enter', { targetInsidePopover: true }),
		false,
	);
	assert.equal(shouldConsumeArmedKey('Tab', { targetInsidePopover: true }), true);
	assert.equal(shouldConsumeArmedKey('Tab', { targetInsidePopover: false }), true);
	assert.equal(shouldConsumeArmedKey('Escape'), false);
});

test('stepFocusableIndex wraps and starts from an end when nothing is focused', () => {
	assert.equal(stepFocusableIndex(0, 0, 1), -1);
	assert.equal(stepFocusableIndex(3, -1, 1), 0);
	assert.equal(stepFocusableIndex(3, -1, -1), 2);
	assert.equal(stepFocusableIndex(3, 2, 1), 0);
	assert.equal(stepFocusableIndex(3, 0, -1), 2);
});
