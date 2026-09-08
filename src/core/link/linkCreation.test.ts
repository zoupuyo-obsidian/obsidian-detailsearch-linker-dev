import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	generateHeadingLink,
	resolveHeadingAtOffset,
	sourceMatchesLiveSession,
	targetMtimeMatches,
	type CachedHeading,
} from './linkCreation.ts';

function cachedHeading(heading: string, offset: number): CachedHeading {
	return {
		heading,
		position: {
			start: { offset },
		},
	};
}

test('resolves nearest metadata heading preceding hit offset', () => {
	const headings = [
		cachedHeading('First', 10),
		cachedHeading('Nearest', 50),
		cachedHeading('Later', 100),
	];
	assert.equal(resolveHeadingAtOffset(headings, 80, 'scan fallback'), 'Nearest');
});

test('uses Obsidian parsed Setext heading cache input', () => {
	const headings = [cachedHeading('Parsed Setext *formatting*', 12)];
	assert.equal(
		resolveHeadingAtOffset(headings, 40, 'scan fallback'),
		'Parsed Setext *formatting*',
	);
});

test('returns no heading when available metadata has none before hit', () => {
	assert.equal(
		resolveHeadingAtOffset([cachedHeading('Later', 100)], 20, 'scan fallback'),
		'',
	);
});

test('falls back to scan heading only when metadata cache is unavailable', () => {
	assert.equal(resolveHeadingAtOffset(null, 20, 'scan fallback'), 'scan fallback');
});

test('detects target mtime mismatch', () => {
	assert.equal(targetMtimeMatches(10, 10), true);
	assert.equal(targetMtimeMatches(10, 11), false);
});

test('rejects link action when source and live session files differ', () => {
	assert.equal(sourceMatchesLiveSession('Source.md', 'Source.md'), true);
	assert.equal(sourceMatchesLiveSession('Other.md', 'Source.md'), false);
	assert.equal(sourceMatchesLiveSession('', ''), false);
});

test('passes target, source path, heading subpath, and alias to generator', () => {
	const target = { path: 'Folder/Target.md' };
	const calls: unknown[][] = [];
	const generated = generateHeadingLink(
		(file, sourcePath, subpath, alias) => {
			calls.push([file, sourcePath, subpath, alias]);
			return 'generated link';
		},
		target,
		'Source.md',
		'Special | # ]] heading',
		'original display',
	);

	assert.equal(generated, 'generated link');
	assert.deepEqual(calls, [
		[target, 'Source.md', '#Special | # ]] heading', 'original display'],
	]);
});
