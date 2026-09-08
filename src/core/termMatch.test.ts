import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	anchorStillValid,
	findTermOccurrences,
	hasLatinBoundary,
	normalizeTerm,
} from './search/termMatch.ts';
import { findProtectedSpans } from './protectedSpans.ts';

test('case insensitive normalize', () => {
	assert.equal(normalizeTerm('Hello', false), 'hello');
	assert.equal(normalizeTerm('Hello', true), 'Hello');
});

test('latin boundary rejects partial word', () => {
	const text = 'prefixWord suffix';
	const idx = text.indexOf('Word');
	assert.equal(hasLatinBoundary(text, idx, idx + 4), false);
});

test('findTermOccurrences skips protected wikilink', () => {
	const text = 'see [[救急]] and 救急 here';
	const spans = findProtectedSpans(text);
	const hits = findTermOccurrences(text, '救急', false, spans);
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.text, '救急');
});

test('findTermOccurrences finds Japanese', () => {
	const text = '認知負荷の話';
	const spans = findProtectedSpans(text);
	const hits = findTermOccurrences(text, '認知負荷', false, spans);
	assert.equal(hits.length, 1);
});

test('findTermOccurrences preserves offsets after expanded case folds', () => {
	const text = 'İ target';
	const hits = findTermOccurrences(text, 'target', false, []);
	assert.deepEqual(hits, [{
		from: text.indexOf('target'),
		to: text.length,
		text: 'target',
	}]);
});

test('findTermOccurrences maps an expanded query to the full source range', () => {
	const text = 'before i\u0307 after';
	const from = text.indexOf('i');
	const hits = findTermOccurrences(text, 'İ', false, []);

	assert.deepEqual(hits, [{
		from,
		to: from + 2,
		text: 'i\u0307',
	}]);
});

test('anchorStillValid detects edit', () => {
	const text = 'hello world';
	assert.equal(anchorStillValid(text, 0, 5, 'hello', false), true);
	assert.equal(anchorStillValid(text, 0, 5, 'help', false), false);
});
