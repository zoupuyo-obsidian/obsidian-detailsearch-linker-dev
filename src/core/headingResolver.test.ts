import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findHeadings, hydrateHitExcerpt, nearestHeading } from './search/headingResolver.ts';

test('finds ATX headings outside code', () => {
	const text = '# Title\n\n## Section\n\n```\n# fake\n```\n\n### Real';
	const headings = findHeadings(text);
	assert.equal(headings.length, 3);
	assert.equal(headings[0]!.text, 'Title');
	assert.equal(headings[1]!.text, 'Section');
	assert.equal(headings[2]!.text, 'Real');
});

test('nearestHeading picks preceding heading', () => {
	const text = '# A\n\nbody\n\n## B\n\nmatch here';
	const headings = findHeadings(text);
	const pos = text.indexOf('match');
	const h = nearestHeading(headings, pos);
	assert.equal(h?.text, 'B');
});

test('no heading returns empty nearest', () => {
	const text = 'plain text only';
	const headings = findHeadings(text);
	assert.equal(nearestHeading(headings, 5), null);
});

test('finds Setext h1 and h2 headings', () => {
	const text = 'First heading\n===\n\n  Second heading  \n  ---\nbody';
	const headings = findHeadings(text);
	assert.deepEqual(
		headings.map(({ level, text: headingText, offset }) => ({ level, text: headingText, offset })),
		[
			{ level: 1, text: 'First heading', offset: 0 },
			{ level: 2, text: 'Second heading', offset: text.indexOf('  Second') },
		],
	);
});

test('ignores Setext-like headings inside fences', () => {
	const text = '~~~\nFake\n===\n~~~\n\nReal\n---\nbody';
	const headings = findHeadings(text);
	assert.deepEqual(
		headings.map(({ level, text: headingText }) => ({ level, text: headingText })),
		[{ level: 2, text: 'Real' }],
	);
});

test('nearestHeading includes preceding Setext headings', () => {
	const text = 'Top\n===\nintro\n\nSection\n---\nmatch here';
	const headings = findHeadings(text);
	const heading = nearestHeading(headings, text.indexOf('match'));
	assert.equal(heading?.text, 'Section');
	assert.equal(heading?.level, 2);
});

test('does not treat protected markdown link text as Setext heading', () => {
	const text = '[linked title](note.md)\n---\nbody';
	assert.deepEqual(findHeadings(text), []);
});

test('does not treat four-space indented text as a Setext heading', () => {
	const text = '    indented code\n---\nbody';
	assert.deepEqual(findHeadings(text), []);
});

test('hydrateHitExcerpt rebuilds a window around a cached offset', () => {
	const text = `${'alpha '.repeat(20)}target${' omega'.repeat(20)}`;
	const offset = text.indexOf('target');
	const excerpt = hydrateHitExcerpt(text, offset, 'target', false, 80);
	assert.ok(excerpt.includes('target'));
	assert.ok(excerpt.startsWith('…'));
	assert.ok(excerpt.endsWith('…'));
	assert.ok(excerpt.length < text.length);
});

test('hydrateHitExcerpt maps an expanded case fold back to the source range', () => {
	const text = 'İ target after';
	const offset = text.indexOf('target');
	const excerpt = hydrateHitExcerpt(text, offset, 'target', false, 40);
	assert.ok(excerpt.includes('target'));
});
