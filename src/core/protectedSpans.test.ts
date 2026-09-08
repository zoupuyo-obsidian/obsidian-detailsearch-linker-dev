import assert from 'node:assert/strict';
import { test } from 'node:test';
import { covers, findProtectedSpans } from './protectedSpans.ts';

test('skips YAML frontmatter', () => {
	const text = '---\ntitle: x\n---\n本文救急';
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, 0, 10), true);
	const bodyAt = text.indexOf('救急');
	assert.equal(covers(spans, bodyAt, bodyAt + 2), false);
});

test('skips existing wikilinks', () => {
	const text = '前[[救急]]後';
	const spans = findProtectedSpans(text);
	const inner = text.indexOf('救急');
	assert.equal(covers(spans, inner, inner + 2), true);
});

test('skips inline code', () => {
	const text = 'code `救急` here';
	const spans = findProtectedSpans(text);
	const inner = text.indexOf('救急');
	assert.equal(covers(spans, inner, inner + 2), true);
});

test('fence closing follows marker and run-length rules', () => {
	const fourTicks = '````js\ninside\n```\nstill inside\n````\noutside';
	const fourSpans = findProtectedSpans(fourTicks);
	assert.equal(covers(fourSpans, fourTicks.indexOf('still'), fourTicks.indexOf('still') + 5), true);
	assert.equal(covers(fourSpans, fourTicks.indexOf('outside'), fourTicks.length), false);

	const longerClose = '```\ninside\n`````\noutside';
	const longerSpans = findProtectedSpans(longerClose);
	assert.equal(covers(longerSpans, longerClose.indexOf('inside'), longerClose.indexOf('inside') + 6), true);
	assert.equal(covers(longerSpans, longerClose.indexOf('outside'), longerClose.length), false);

	const tilde = '~~~md\ninside\n~~~\noutside';
	const tildeSpans = findProtectedSpans(tilde);
	assert.equal(covers(tildeSpans, tilde.indexOf('inside'), tilde.indexOf('inside') + 6), true);
	assert.equal(covers(tildeSpans, tilde.indexOf('outside'), tilde.length), false);
});

test('unclosed fence protects through EOF', () => {
	const text = 'before\n```\ninside\nplain';
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, text.indexOf('plain'), text.length), true);
	assert.equal(covers(spans, 0, 6), false);
});

test('frontmatter supports CRLF and dot close', () => {
	const text = '---\r\ntitle: x\r\n...\r\nbody';
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, text.indexOf('title'), text.indexOf('title') + 5), true);
	assert.equal(covers(spans, text.indexOf('body'), text.length), false);
});

test('unclosed frontmatter delimiter does not hide the document', () => {
	const text = '---\ntitle: x\nsearchable';
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, text.indexOf('searchable'), text.length), false);
});

test('code span closes only on an equal backtick run', () => {
	const text = 'before `` code ` inside `` after';
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, text.indexOf('code'), text.indexOf('inside') + 6), true);
	assert.equal(covers(spans, text.indexOf('after'), text.length), false);
});

test('protects nested markdown destinations, escaped labels, and references', () => {
	const text =
		'[nested](path_(nested).md "title") [escaped \\] label](target.md) [label][id] [collapsed][]';
	const spans = findProtectedSpans(text);
	for (const term of ['nested', 'escaped', 'label', 'collapsed']) {
		const start = text.indexOf(term);
		assert.equal(covers(spans, start, start + term.length), true, term);
	}
});

test('bounds malformed markdown destination scanning by depth and size', () => {
	const malformed = '[x]('.repeat(10_000);
	assert.deepEqual(findProtectedSpans(malformed), []);

	const maxDepthDestination = `${'('.repeat(31)}x${')'.repeat(31)}`;
	const accepted = `[x](${maxDepthDestination})`;
	assert.equal(covers(findProtectedSpans(accepted), 0, accepted.length), true);

	const tooDeepDestination = `${'('.repeat(32)}x${')'.repeat(32)}`;
	const tooDeep = `[x](${tooDeepDestination})`;
	assert.equal(covers(findProtectedSpans(tooDeep), 0, tooDeep.length), false);

	const overScanBudget = `[x](${'a'.repeat(4096)})`;
	assert.equal(covers(findProtectedSpans(overScanBudget), 0, overScanBudget.length), false);
});

test('unclosed inline constructs do not hide following plain text', () => {
	for (const text of ['[[broken plain term', '[broken](path plain term', '<!-- broken plain term']) {
		const spans = findProtectedSpans(text);
		const start = text.indexOf('plain term');
		assert.equal(covers(spans, start, start + 'plain term'.length), false, text);
	}
});

test('math ignores escaped dollars and protects closed math', () => {
	const text = String.raw`price \$5 and $x + 1$ then $$y
+ z$$ end`;
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, text.indexOf('$5'), text.indexOf('$5') + 2), false);
	assert.equal(covers(spans, text.indexOf('x + 1'), text.indexOf('x + 1') + 5), true);
	assert.equal(covers(spans, text.indexOf('y'), text.indexOf('z') + 1), true);
	assert.equal(covers(spans, text.indexOf('end'), text.length), false);
});

test('does not pair a currency opener with later math', () => {
	const text = 'cost $5 then $x+1$ end';
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, text.indexOf('$5'), text.indexOf('$5') + 2), false);
	assert.equal(covers(spans, text.indexOf('x+1'), text.indexOf('x+1') + 3), true);
});

test('protects complete Unicode tags but not ATX heading markers', () => {
	const text = '# 見出し\n本文 #日本語タグ/子-1 and https://example.test/#fragment';
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, 0, 1), false);
	const tagStart = text.indexOf('#日本語');
	assert.equal(covers(spans, tagStart, tagStart + '#日本語タグ/子-1'.length), true);
	const fragment = text.indexOf('#fragment');
	assert.equal(covers(spans, fragment, fragment + '#fragment'.length), false);
});

test('protects tags containing astral Unicode letters through their full UTF-16 range', () => {
	const text = 'before #𐐀タグ/子-1 after';
	const tag = '#𐐀タグ/子-1';
	const start = text.indexOf(tag);
	const spans = findProtectedSpans(text);
	assert.equal(covers(spans, start, start + tag.length), true);
	assert.deepEqual(spans, [{ start, end: start + tag.length }]);
});
