import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractQueryCandidates, type ExtractSettings } from '../extract/queryExtractor.ts';
import {
	addIgnoredTerm,
	filterIgnoredExtractedCandidates,
	isIgnoredTerm,
	normalizeIgnoredTerms,
	parseIgnoredTermsText,
} from './ignoredTerms.ts';

const BASE: ExtractSettings = {
	focusedExtraction: true,
	normalProsePhrases: false,
	broadNgram: false,
	minTermLength: 3,
	maxTermLength: 32,
	ngramMinLength: 2,
	ngramMaxLength: 4,
	maxAutoQueries: 40,
	ngramSpanLimit: 8,
	stopWords: [],
	ignoredTerms: [],
	caseSensitive: false,
};

test('normalizeIgnoredTerms trims, dedupes case-insensitively, drops empty lines', () => {
	assert.deepEqual(normalizeIgnoredTerms([' Foo ', 'foo', 'BAR', '  ', 'bar'], false), [
		'Foo',
		'BAR',
	]);
});

test('normalizeIgnoredTerms dedupes case-sensitively when enabled', () => {
	assert.deepEqual(normalizeIgnoredTerms(['Foo', 'foo'], true), ['Foo', 'foo']);
	assert.deepEqual(normalizeIgnoredTerms(['Foo', 'foo'], false), ['Foo']);
});

test('parseIgnoredTermsText applies same rules as normalizeIgnoredTerms', () => {
	assert.deepEqual(parseIgnoredTermsText('alpha\n\nBeta\nalpha', false), ['alpha', 'Beta']);
});

test('addIgnoredTerm appends trimmed display form without duplicate', () => {
	assert.deepEqual(addIgnoredTerm(['Alpha'], ' alpha ', false), ['Alpha']);
	assert.deepEqual(addIgnoredTerm(['Alpha'], 'beta', false), ['Alpha', 'beta']);
});

test('isIgnoredTerm matches per caseSensitive setting', () => {
	assert.equal(isIgnoredTerm('Foo', ['foo'], false), true);
	assert.equal(isIgnoredTerm('Foo', ['foo'], true), false);
	assert.equal(isIgnoredTerm('認知負荷', ['認知負荷'], false), true);
});

test('filterIgnoredExtractedCandidates removes ignored queries only', () => {
	const candidates = [
		{
			query: 'alpha',
			displayText: 'alpha',
			source: 'heading' as const,
			score: 1000,
			anchors: [{ from: 0, to: 5, text: 'alpha' }],
		},
		{
			query: 'beta',
			displayText: 'beta',
			source: 'emphasis' as const,
			score: 900,
			anchors: [{ from: 10, to: 14, text: 'beta' }],
		},
	];
	const filtered = filterIgnoredExtractedCandidates(candidates, ['Alpha'], false);
	assert.equal(filtered.length, 1);
	assert.equal(filtered[0]!.query, 'beta');
});

test('extractQueryCandidates excludes ignoredTerms from auto extract', () => {
	const text = '## Alpha Topic\n\nSome **beta** text here.';
	const out = extractQueryCandidates(text, { ...BASE, ignoredTerms: ['alpha topic'] });
	assert.ok(out.some((c) => c.query.toLowerCase().includes('beta')));
	assert.ok(!out.some((c) => c.query.toLowerCase() === 'alpha topic'));
});

test('ignoredTerms do not block explicit selection search contract', () => {
	const ignored = ['manual term'];
	assert.equal(isIgnoredTerm('manual term', ignored, false), true);
	// Selection / modal search paths never call extractQueryCandidates filtering;
	// auto path is the only consumer of ignoredTerms in ExtractSettings.
	const autoOnly = extractQueryCandidates('## manual term', {
		...BASE,
		ignoredTerms: ignored,
	});
	assert.equal(autoOnly.length, 0);
});
