import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildAnchorSpots,
	ModalQuerySource,
	modalQueryMissingInNote,
	SelectionQuerySource,
} from './query/selectionSource.ts';
import { SearchCoordinator } from './search/searchCoordinator.ts';
import { anchorStillValid } from './search/termMatch.ts';
import { trimSelectionRange, validateQuery } from './query/queryValidation.ts';
import { QueryCache } from './cache/queryCache.ts';

test('selection trims anchor range', () => {
	const text = 'xx  term  yy';
	const req = new SelectionQuerySource().resolve(text, 3, 9, false);
	assert.equal(req?.query, 'term');
	assert.equal(req?.displayText, 'term');
	assert.equal(req?.anchorFrom, 4);
	assert.equal(req?.anchorTo, 8);
});

test('selection rejects newline', () => {
	assert.equal(new SelectionQuerySource().resolve('a\nb', 0, 3, false), null);
});

test('selection rejects protected wikilink range', () => {
	const text = 'See [[linked term]] here';
	const from = text.indexOf('linked');
	const to = from + 'linked'.length;
	assert.equal(new SelectionQuerySource().resolve(text, from, to, false), null);
});

test('modal source returns null when term missing in note', () => {
	const req = new ModalQuerySource('missing').resolve('hello world', 0, 0, false);
	assert.equal(req, null);
});

test('modal missing term skips vault scan contract', async () => {
	const text = 'hello world';
	assert.equal(modalQueryMissingInNote(text, 'missing', false), true);
	let scanCalled = false;
	const cache = new QueryCache({ mode: 'memory', maxBytes: 1024 * 1024 });
	const coordinator = new SearchCoordinator(cache, async () => {
		scanCalled = true;
		return { content: 'missing', mtime: 1 };
	});
	const req = new ModalQuerySource('missing').resolve(text, 0, 0, false);
	if (req) {
		await coordinator.execute({
			request: req,
			scopeSettings: {
				includeFolders: [],
				excludeFolders: [],
				scopeMode: 'all',
				recentDays: 0,
				worksetPaths: [],
				maxFiles: 500,
				maxFileBytes: 2_000_000,
			},
			scopedFiles: [{ path: 'a.md', statMtime: 1, size: 10 }],
			scanOptions: {
				excerptLength: 80,
				maxHitsPerNote: 10,
				maxCandidateNotes: 50,
				readConcurrency: 1,
			},
		});
	}
	assert.equal(scanCalled, false);
});

test('modal source finds first safe anchor when term appears multiple times', () => {
	const text = 'world and world again';
	const req = new ModalQuerySource('world').resolve(text, 0, 0, false);
	assert.ok(req);
	assert.equal(req!.anchorFrom, 0);
	assert.equal(req!.canLink, true);
});

test('buildAnchorSpots uses trimmed selection range', () => {
	const text = 'xx term yy';
	const req = new SelectionQuerySource().resolve(text, 2, 8, false)!;
	const spots = buildAnchorSpots(text, req);
	assert.equal(spots.length, 1);
	assert.equal(spots[0]!.text, 'term');
	assert.equal(text.slice(spots[0]!.from, spots[0]!.to), 'term');
});

test('trimSelectionRange handles leading and trailing spaces', () => {
	const text = '  hello  ';
	const trimmed = trimSelectionRange(text, 0, 9);
	assert.deepEqual(trimmed, { from: 2, to: 7, query: 'hello', displayText: 'hello' });
});

test('validateQuery rejects too long input', () => {
	assert.equal(validateQuery('a'.repeat(257)), 'too_long');
});

test('validateQuery rejects wikilink-breaking characters', () => {
	assert.equal(validateQuery('a|b'), 'link_syntax');
	assert.equal(validateQuery('a]b'), 'link_syntax');
	assert.equal(validateQuery('a[b'), 'link_syntax');
	assert.equal(validateQuery('認知、負荷'), null);
});

test('anchor safety after simulated edit', () => {
	const original = 'search term here';
	const from = original.indexOf('term');
	const to = from + 4;
	assert.equal(anchorStillValid(original, from, to, 'term', false), true);
	const edited = 'search changed here';
	assert.equal(anchorStillValid(edited, from, to, 'term', false), false);
});
