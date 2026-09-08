import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitHighlightedText } from './splitHighlightedText.ts';

function texts(segments: ReturnType<typeof splitHighlightedText>): string[] {
	return segments.map((s) => s.text);
}

function highlighted(segments: ReturnType<typeof splitHighlightedText>): string[] {
	return segments.filter((s) => s.highlighted).map((s) => s.text);
}

test('splitHighlightedText returns plain text for empty query', () => {
	const segments = splitHighlightedText('hello world', '', false);
	assert.deepEqual(segments, [{ text: 'hello world', highlighted: false }]);
	assert.deepEqual(splitHighlightedText('hello', '   ', false), [
		{ text: 'hello', highlighted: false },
	]);
});

test('splitHighlightedText highlights all case-insensitive matches', () => {
	const segments = splitHighlightedText('Foo foo FOO', 'foo', false);
	assert.deepEqual(highlighted(segments), ['Foo', 'foo', 'FOO']);
	assert.deepEqual(texts(segments).join(''), 'Foo foo FOO');
});

test('splitHighlightedText is case-sensitive when requested', () => {
	const segments = splitHighlightedText('Foo foo', 'foo', true);
	assert.deepEqual(highlighted(segments), ['foo']);
});

test('splitHighlightedText handles Japanese without locale offset drift', () => {
	const excerpt = 'これは認知負荷の例です。認知負荷を下げる。';
	const segments = splitHighlightedText(excerpt, '認知負荷', false);
	assert.deepEqual(highlighted(segments), ['認知負荷', '認知負荷']);
	assert.deepEqual(texts(segments).join(''), excerpt);
});

test('splitHighlightedText maps expanded case folds back to source offsets', () => {
	const excerpt = 'İ target after';
	const segments = splitHighlightedText(excerpt, 'target', false);
	assert.deepEqual(highlighted(segments), ['target']);
	assert.deepEqual(texts(segments).join(''), excerpt);
});

test('splitHighlightedText highlights a full expanded source match', () => {
	const excerpt = 'before i\u0307 after';
	const segments = splitHighlightedText(excerpt, 'İ', false);
	assert.deepEqual(highlighted(segments), ['i\u0307']);
	assert.deepEqual(texts(segments).join(''), excerpt);
});

test('splitHighlightedText returns plain excerpt when query not found', () => {
	const segments = splitHighlightedText('no match here', 'missing', false);
	assert.deepEqual(segments, [{ text: 'no match here', highlighted: false }]);
});

test('splitHighlightedText highlights non-overlapping repeated matches', () => {
	const segments = splitHighlightedText('aaaa', 'aa', false);
	assert.deepEqual(highlighted(segments), ['aa', 'aa']);
});

test('splitHighlightedText handles empty excerpt', () => {
	assert.deepEqual(splitHighlightedText('', 'term', false), []);
});

test('splitHighlightedText trims query for matching', () => {
	const segments = splitHighlightedText('hello world', '  world  ', false);
	assert.deepEqual(highlighted(segments), ['world']);
});
