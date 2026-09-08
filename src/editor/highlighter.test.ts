import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import {
	detailSessionField,
	planHighlightRanges,
	readDetailSession,
	canPaintSession,
	sessionMatchesDocument,
	setDetailSessionEffect,
} from './highlighter.ts';
import { emptySession, type DetailSessionState } from '../session.ts';

function session(
	caseSensitive = true,
	overrides: Partial<DetailSessionState> = {},
): DetailSessionState {
	return {
		...emptySession(),
		filePath: 'source.md',
		anchors: [
			{ id: 'a', from: 2, to: 8, text: 'target', groupKey: 'target' },
		],
		caseSensitive,
		showBadge: false,
		...overrides,
	};
}

function stateWithSession(
	doc = 'a target z',
	value = session(),
): EditorState {
	const initial = EditorState.create({
		doc,
		extensions: [detailSessionField],
	});
	return initial.update({
		effects: setDetailSessionEffect.of(value),
	}).state;
}

test('readDetailSession returns null when the field is not registered', () => {
	const state = EditorState.create({ doc: 'plain' });
	assert.doesNotThrow(() => readDetailSession(state));
	assert.equal(readDetailSession(state), null);
});

test('full-document replacement clears an existing session', () => {
	const state = stateWithSession();
	const replaced = state.update({
		changes: [
			{ from: 0, to: 2, insert: 'new ' },
			{ from: 2, to: state.doc.length, insert: 'document' },
		],
	}).state;

	assert.deepEqual(readDetailSession(replaced), emptySession());
});

test('changing text inside an anchor drops it', () => {
	const changed = stateWithSession().update({
		changes: { from: 4, to: 5, insert: 'X' },
	}).state;

	assert.deepEqual(readDetailSession(changed), emptySession());
});

test('inserting before an anchor maps its range and preserves it', () => {
	const changed = stateWithSession().update({
		changes: { from: 0, insert: 'prefix ' },
	}).state;

	assert.deepEqual(readDetailSession(changed)?.anchors, [
		{ id: 'a', from: 9, to: 15, text: 'target', groupKey: 'target' },
	]);
});

test('case-only edits preserve insensitive anchors and drop sensitive anchors', () => {
	const edit = { from: 2, to: 8, insert: 'TARGET' };
	const insensitive = stateWithSession('a target z', session(false))
		.update({ changes: edit }).state;
	const sensitive = stateWithSession().update({ changes: edit }).state;

	assert.deepEqual(readDetailSession(insensitive)?.anchors, [
		{ id: 'a', from: 2, to: 8, text: 'target', groupKey: 'target' },
	]);
	assert.deepEqual(readDetailSession(sensitive)?.anchors, []);
});

test('decoration planning drops stale out-of-bounds anchors', () => {
	const ranges = planHighlightRanges(
		session(true, {
			anchors: [
				{ id: 'negative', from: -1, to: 2, text: 'a', groupKey: 'target' },
				{ id: 'valid', from: 2, to: 8, text: 'target', groupKey: 'target' },
				{ id: 'past-end', from: 8, to: 12, text: 'z', groupKey: 'target' },
			],
		}),
		'a target z',
	);

	assert.deepEqual(ranges, [
		{ from: 2, to: 8, kind: 'mark', sortOrder: 0 },
	]);
});

test('decoration planning drops anchors whose text no longer matches the document', () => {
	const ranges = planHighlightRanges(session(), 'a XXXXXX z');
	assert.deepEqual(ranges, []);
});

test('sessionMatchesDocument rejects a source session on a different note body', () => {
	const value = session();
	assert.equal(sessionMatchesDocument(value, 'a target z'), true);
	assert.equal(sessionMatchesDocument(value, 'unrelated target note body'), false);
	assert.equal(sessionMatchesDocument(emptySession(), 'a target z'), false);
	assert.equal(
		sessionMatchesDocument(
			session(true, {
				anchors: [
					{ id: 'expanded', from: 0, to: 18, text: 'target', groupKey: 'target' },
				],
			}),
			'entire document body',
		),
		false,
	);
});

test('canPaintSession requires the editor to be bound to the session file', () => {
	const value = session();
	assert.equal(canPaintSession(value, 'source.md', 'a target z'), true);
	assert.equal(canPaintSession(value, 'target.md', 'a target z'), false);
	assert.equal(canPaintSession(value, '', 'a target z'), false);
	assert.equal(canPaintSession(emptySession(), 'source.md', 'a target z'), false);
});

test('decoration planning drops ranges expanded beyond the original term', () => {
	const ranges = planHighlightRanges(
		session(true, {
			anchors: [
				{ id: 'expanded', from: 0, to: 18, text: 'target', groupKey: 'target' },
			],
		}),
		'entire document body',
	);
	assert.deepEqual(ranges, []);
});
