import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildAutoSession,
	emptySession,
	type ResultGroup,
	type SessionAnchor,
} from '../../session.ts';
import { removeGroupFromSession, resolveIgnoreGroupKey } from './sessionIgnore.ts';
import { groupKeyForQuery } from '../extract/queryExtractor.ts';

function group(key: string, query: string): ResultGroup {
	return {
		key,
		query,
		displayText: query,
		canLink: true,
		candidates: [],
	};
}

function anchor(id: string, groupKey: string): SessionAnchor {
	return { id, from: 0, to: 4, text: 'term', groupKey };
}

test('removeGroupFromSession drops all anchors for groupKey', () => {
	const session = buildAutoSession({
		filePath: 'note.md',
		groups: [group('a', 'alpha'), group('b', 'beta')],
		anchors: [anchor('1', 'a'), anchor('2', 'a'), anchor('3', 'b')],
		style: 'invert',
		showBadge: true,
		caseSensitive: false,
	});
	const next = removeGroupFromSession(session, 'a');
	assert.equal(next.groups.length, 1);
	assert.equal(next.groups[0]!.key, 'b');
	assert.deepEqual(
		next.anchors.map((a) => a.id),
		['3'],
	);
});

test('removeGroupFromSession keeps other groups untouched', () => {
	const session = buildAutoSession({
		filePath: 'note.md',
		groups: [group('x', 'one'), group('y', 'two')],
		anchors: [anchor('1', 'x'), anchor('2', 'y')],
		style: 'marker',
		showBadge: true,
		caseSensitive: false,
	});
	const next = removeGroupFromSession(session, 'x');
	assert.equal(next.filePath, 'note.md');
	assert.equal(next.groups[0]!.query, 'two');
	assert.equal(next.anchors[0]!.groupKey, 'y');
});

test('removeGroupFromSession clears session when last group removed', () => {
	const session = buildAutoSession({
		filePath: 'note.md',
		groups: [group('only', 'solo')],
		anchors: [anchor('1', 'only')],
		style: 'invert',
		showBadge: true,
		caseSensitive: false,
	});
	const next = removeGroupFromSession(session, 'only');
	assert.deepEqual(next, emptySession());
});

test('removeGroupFromSession uses original groupKey after caseSensitive change', () => {
	const session = buildAutoSession({
		filePath: 'note.md',
		groups: [group('foo', 'Foo'), group('beta', 'beta')],
		anchors: [anchor('1', 'foo'), anchor('2', 'beta')],
		style: 'invert',
		showBadge: true,
		caseSensitive: true,
	});
	const recalculatedKey = groupKeyForQuery('Foo', true);
	assert.equal(recalculatedKey, 'Foo');
	const failed = removeGroupFromSession(session, recalculatedKey);
	assert.equal(failed.groups.length, 2);
	assert.equal(failed.anchors.length, 2);

	const next = removeGroupFromSession(session, 'foo');
	assert.equal(next.groups.length, 1);
	assert.equal(next.groups[0]!.key, 'beta');
	assert.deepEqual(
		next.anchors.map((a) => a.groupKey),
		['beta'],
	);
});

test('resolveIgnoreGroupKey prefers passed session groupKey over recalculation', () => {
	assert.equal(resolveIgnoreGroupKey('Foo', 'foo', true), 'foo');
	assert.equal(resolveIgnoreGroupKey('Foo', '', true), 'Foo');
});
