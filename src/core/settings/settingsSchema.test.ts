import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_SETTINGS,
	INTEGER_SETTING_BOUNDS,
	migrateSettingsCore,
	repairOrderedPairAfterChange,
} from './settingsSchema';

test('empty and non-object input produce isolated defaults', () => {
	for (const raw of [undefined, null, 42, 'settings', []]) {
		const settings = migrateSettingsCore(raw);
		assert.deepEqual(settings, DEFAULT_SETTINGS);
		assert.notStrictEqual(settings.includeFolders, DEFAULT_SETTINGS.includeFolders);
		assert.notStrictEqual(settings.autoStopWords, DEFAULT_SETTINGS.autoStopWords);
		assert.notStrictEqual(settings.ignoredTerms, DEFAULT_SETTINGS.ignoredTerms);
	}
});

test('invalid enum and boolean values use defaults', () => {
	const settings = migrateSettingsCore({
		uiLanguage: 'fr',
		scopeMode: 'somewhere',
		cacheMode: 1,
		highlightStyle: 'flash',
		caseSensitive: 'true',
		showBadge: 1,
		clearOnFileChange: null,
		focusedExtraction: {},
		normalProsePhrases: 'false',
		broadNgram: [],
	}, { defaultUiLanguage: () => 'ja' });

	assert.equal(settings.uiLanguage, 'ja');
	assert.equal(settings.scopeMode, DEFAULT_SETTINGS.scopeMode);
	assert.equal(settings.cacheMode, DEFAULT_SETTINGS.cacheMode);
	assert.equal(settings.highlightStyle, DEFAULT_SETTINGS.highlightStyle);
	for (const key of [
		'caseSensitive',
		'showBadge',
		'clearOnFileChange',
		'focusedExtraction',
		'normalProsePhrases',
		'broadNgram',
	] as const) {
		assert.equal(settings[key], DEFAULT_SETTINGS[key]);
	}
});

test('mixed arrays retain only normalized non-empty strings', () => {
	const settings = migrateSettingsCore({
		includeFolders: [' Notes ', 1, '', 'Notes', 'Nested\\Path', null],
		excludeFolders: [false, ' Archive '],
		autoStopWords: [' KeepCase ', '', 4, 'keepcase'],
		ignoredTerms: [' Alpha ', 3, '', 'alpha'],
	}, {
		normalizePath: (path) => path.replace(/\\/g, '/'),
	});

	assert.deepEqual(settings.includeFolders, ['Notes', 'Nested/Path']);
	assert.deepEqual(settings.excludeFolders, ['Archive']);
	assert.deepEqual(settings.autoStopWords, ['KeepCase', 'keepcase']);
	assert.deepEqual(settings.ignoredTerms, ['Alpha']);
});

test('nonfinite values and numeric strings fall back while fractions round', () => {
	const settings = migrateSettingsCore({
		recentDays: Number.NaN,
		worksetSize: Number.POSITIVE_INFINITY,
		maxFiles: '1000',
		cacheMaxMb: 7.49,
		excerptLength: 160.5,
	});

	assert.equal(settings.recentDays, DEFAULT_SETTINGS.recentDays);
	assert.equal(settings.worksetSize, DEFAULT_SETTINGS.worksetSize);
	assert.equal(settings.maxFiles, DEFAULT_SETTINGS.maxFiles);
	assert.equal(settings.cacheMaxMb, 7);
	assert.equal(settings.excerptLength, 161);
});

test('all integer settings clamp to their shared bounds', () => {
	const low: Record<string, number> = {};
	const high: Record<string, number> = {};
	for (const [key, bound] of Object.entries(INTEGER_SETTING_BOUNDS)) {
		low[key] = bound.min - 10_000;
		high[key] = bound.max + 10_000;
	}

	const lowSettings = migrateSettingsCore(low);
	const highSettings = migrateSettingsCore(high);
	for (const [key, bound] of Object.entries(INTEGER_SETTING_BOUNDS)) {
		assert.equal(lowSettings[key as keyof typeof lowSettings], bound.min, `${key} minimum`);
		assert.equal(highSettings[key as keyof typeof highSettings], bound.max, `${key} maximum`);
	}
});

test('ordered pairs preserve valid user minima when values are reversed', () => {
	const settings = migrateSettingsCore({
		autoMinTermLength: 11,
		autoMaxTermLength: 5,
		ngramMinLength: 9,
		ngramMaxLength: Number.NaN,
	});
	assert.equal(settings.autoMinTermLength, 11);
	assert.equal(settings.autoMaxTermLength, 11);
	assert.equal(settings.ngramMinLength, 9);
	assert.equal(settings.ngramMaxLength, 9);
});

test('ordered pairs preserve a valid maximum when the minimum is invalid', () => {
	const settings = migrateSettingsCore({
		autoMinTermLength: 'bad',
		autoMaxTermLength: 4,
		ngramMinLength: null,
		ngramMaxLength: 2,
	});
	assert.equal(settings.autoMinTermLength, 3);
	assert.equal(settings.autoMaxTermLength, 4);
	assert.equal(settings.ngramMinLength, 2);
	assert.equal(settings.ngramMaxLength, 2);
});

test('mutating migrated arrays cannot change defaults or another migration', () => {
	const first = migrateSettingsCore({});
	first.autoStopWords.push('mutation');
	first.includeFolders.push('folder');

	const second = migrateSettingsCore({});
	assert.deepEqual(second.autoStopWords, DEFAULT_SETTINGS.autoStopWords);
	assert.deepEqual(second.includeFolders, []);
	assert.ok(!DEFAULT_SETTINGS.autoStopWords.includes('mutation'));
});

test('path normalizer dependency is applied after trimming and before dedupe', () => {
	const calls: string[] = [];
	const settings = migrateSettingsCore(
		{ includeFolders: [' /A/ ', '/A/', 7], excludeFolders: [' /B/ '] },
		{
			normalizePath(path) {
				calls.push(path);
				return path.replace(/^\/|\/$/g, '').toLowerCase();
			},
		},
	);
	assert.deepEqual(calls, ['/A/', '/A/', '/B/']);
	assert.deepEqual(settings.includeFolders, ['a']);
	assert.deepEqual(settings.excludeFolders, ['b']);
});

test('raising auto minimum above maximum raises maximum', () => {
	const settings = migrateSettingsCore({});
	settings.autoMaxTermLength = 4;
	settings.autoMinTermLength = 11;
	assert.equal(repairOrderedPairAfterChange(settings, 'autoMinTermLength'), true);
	assert.equal(settings.autoMaxTermLength, 11);
	assert.equal(settings.autoMinTermLength, 11);
});

test('lowering auto maximum below minimum lowers minimum', () => {
	const settings = migrateSettingsCore({});
	settings.autoMinTermLength = 10;
	settings.autoMaxTermLength = 5;
	assert.equal(repairOrderedPairAfterChange(settings, 'autoMaxTermLength'), true);
	assert.equal(settings.autoMinTermLength, 5);
	assert.equal(settings.autoMaxTermLength, 5);
});

test('raising ngram minimum above maximum raises maximum', () => {
	const settings = migrateSettingsCore({});
	settings.ngramMinLength = 9;
	assert.equal(repairOrderedPairAfterChange(settings, 'ngramMinLength'), true);
	assert.equal(settings.ngramMaxLength, 9);
	assert.equal(settings.ngramMinLength, 9);
});

test('lowering ngram maximum below minimum lowers minimum', () => {
	const settings = migrateSettingsCore({});
	settings.ngramMinLength = 9;
	settings.ngramMaxLength = 2;
	assert.equal(repairOrderedPairAfterChange(settings, 'ngramMaxLength'), true);
	assert.equal(settings.ngramMinLength, 2);
	assert.equal(settings.ngramMaxLength, 2);
});

test('ordered-pair repair is a no-op for unrelated and already-valid changes', () => {
	const settings = migrateSettingsCore({});
	const before = { ...settings };
	assert.equal(repairOrderedPairAfterChange(settings, 'maxFiles'), false);
	assert.deepEqual(settings, before);
	assert.equal(repairOrderedPairAfterChange(settings, 'autoMinTermLength'), false);
	assert.deepEqual(settings, before);
});
