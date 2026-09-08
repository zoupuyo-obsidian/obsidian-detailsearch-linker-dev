import { HARD_CAP_AUTO_QUERIES } from '../extract/queryExtractor';
import { normalizeIgnoredTerms } from '../ignore/ignoredTerms';
import { MAX_FILE_BYTES } from '../query/queryValidation';
import type { ScopeMode } from '../search/scopeFilter';

export type UiLanguage = 'ja' | 'en';
export type HighlightStyle = 'invert' | 'marker' | 'color' | 'underline';
export type CacheMode = 'memory' | 'persistent';

export interface DetailSearchLinkerSettings {
	uiLanguage: UiLanguage;
	includeFolders: string[];
	excludeFolders: string[];
	scopeMode: ScopeMode;
	recentDays: number;
	worksetSize: number;
	maxFiles: number;
	maxFileBytes: number;
	caseSensitive: boolean;
	cacheMode: CacheMode;
	cacheMaxMb: number;
	excerptLength: number;
	highlightStyle: HighlightStyle;
	showBadge: boolean;
	clearOnFileChange: boolean;
	maxHitsPerNote: number;
	maxCandidateNotes: number;
	focusedExtraction: boolean;
	normalProsePhrases: boolean;
	broadNgram: boolean;
	autoMinTermLength: number;
	autoMaxTermLength: number;
	ngramMinLength: number;
	ngramMaxLength: number;
	maxAutoQueries: number;
	ngramSpanLimit: number;
	autoStopWords: string[];
	ignoredTerms: string[];
}

export interface IntegerSettingBound {
	min: number;
	max: number;
	step: number;
}

export const INTEGER_SETTING_BOUNDS = {
	recentDays: { min: 0, max: 365, step: 1 },
	worksetSize: { min: 0, max: 500, step: 5 },
	maxFiles: { min: 10, max: 5_000, step: 10 },
	maxFileBytes: { min: 4_096, max: MAX_FILE_BYTES, step: 4_096 },
	cacheMaxMb: { min: 1, max: 64, step: 1 },
	excerptLength: { min: 40, max: 800, step: 20 },
	maxHitsPerNote: { min: 1, max: 30, step: 1 },
	maxCandidateNotes: { min: 5, max: 300, step: 5 },
	autoMinTermLength: { min: 2, max: 12, step: 1 },
	autoMaxTermLength: { min: 4, max: 60, step: 1 },
	ngramMinLength: { min: 2, max: 10, step: 1 },
	ngramMaxLength: { min: 2, max: 12, step: 1 },
	maxAutoQueries: { min: 5, max: HARD_CAP_AUTO_QUERIES, step: 5 },
	ngramSpanLimit: { min: 4, max: 30, step: 1 },
} as const satisfies Record<string, IntegerSettingBound>;

export type IntegerSettingKey = keyof typeof INTEGER_SETTING_BOUNDS;
export type OrderedPairSettingKey =
	| 'autoMinTermLength'
	| 'autoMaxTermLength'
	| 'ngramMinLength'
	| 'ngramMaxLength';

export const DEFAULT_SETTINGS: DetailSearchLinkerSettings = {
	uiLanguage: 'en',
	includeFolders: [],
	excludeFolders: [],
	scopeMode: 'all',
	recentDays: 30,
	worksetSize: 50,
	maxFiles: 500,
	maxFileBytes: 512_000,
	caseSensitive: false,
	cacheMode: 'persistent',
	cacheMaxMb: 8,
	excerptLength: 160,
	highlightStyle: 'invert',
	showBadge: true,
	clearOnFileChange: true,
	maxHitsPerNote: 8,
	maxCandidateNotes: 80,
	focusedExtraction: true,
	normalProsePhrases: true,
	broadNgram: false,
	autoMinTermLength: 3,
	autoMaxTermLength: 32,
	ngramMinLength: 2,
	ngramMaxLength: 6,
	maxAutoQueries: 40,
	ngramSpanLimit: 12,
	autoStopWords: [
		'the', 'a', 'an', 'and', 'or', 'but',
		'の', 'に', 'は', 'を', 'が', 'と', 'で', 'も',
	],
	ignoredTerms: [],
};

export interface SettingsMigrationDependencies {
	defaultUiLanguage?: () => UiLanguage;
	normalizePath?: (path: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

// Settings are discrete counts/sizes. Fractional finite inputs are rounded to
// the nearest integer before clamping; ties follow Math.round semantics.
function integerValue(value: unknown, fallback: number, bound: IntegerSettingBound): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(bound.max, Math.max(bound.min, Math.round(value)));
}

function stringItems(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string');
}

function folderList(value: unknown, fallback: readonly string[], normalizePath: (path: string) => string): string[] {
	if (!Array.isArray(value)) {
		return [...fallback];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of stringItems(value)) {
		const normalized = normalizePath(item.trim()).trim();
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

function trimmedList(value: unknown, fallback: readonly string[]): string[] {
	if (!Array.isArray(value)) {
		return [...fallback];
	}
	return stringItems(value).map((item) => item.trim()).filter(Boolean);
}

function repairOrderedPair(
	settings: DetailSearchLinkerSettings,
	raw: Record<string, unknown>,
	minKey: 'autoMinTermLength' | 'ngramMinLength',
	maxKey: 'autoMaxTermLength' | 'ngramMaxLength',
): void {
	if (settings[minKey] <= settings[maxKey]) {
		return;
	}
	const minWasValid = typeof raw[minKey] === 'number' && Number.isFinite(raw[minKey]);
	const maxWasValid = typeof raw[maxKey] === 'number' && Number.isFinite(raw[maxKey]);
	if (!minWasValid && maxWasValid) {
		settings[minKey] = settings[maxKey];
	} else {
		// Preserve a valid minimum (including when both values were valid) and
		// raise the maximum deterministically.
		settings[maxKey] = settings[minKey];
	}
}

export function repairOrderedPairAfterChange(
	settings: DetailSearchLinkerSettings,
	changedField: string,
): boolean {
	switch (changedField) {
		case 'autoMinTermLength':
			if (settings.autoMinTermLength > settings.autoMaxTermLength) {
				settings.autoMaxTermLength = settings.autoMinTermLength;
				return true;
			}
			return false;
		case 'autoMaxTermLength':
			if (settings.autoMaxTermLength < settings.autoMinTermLength) {
				settings.autoMinTermLength = settings.autoMaxTermLength;
				return true;
			}
			return false;
		case 'ngramMinLength':
			if (settings.ngramMinLength > settings.ngramMaxLength) {
				settings.ngramMaxLength = settings.ngramMinLength;
				return true;
			}
			return false;
		case 'ngramMaxLength':
			if (settings.ngramMaxLength < settings.ngramMinLength) {
				settings.ngramMinLength = settings.ngramMaxLength;
				return true;
			}
			return false;
		default:
			return false;
	}
}

export function migrateSettingsCore(
	rawInput: unknown,
	dependencies: SettingsMigrationDependencies = {},
): DetailSearchLinkerSettings {
	const raw = isRecord(rawInput) ? rawInput : {};
	const normalizePath = dependencies.normalizePath ?? ((path: string) => path);
	const defaultLanguage = dependencies.defaultUiLanguage?.() ?? DEFAULT_SETTINGS.uiLanguage;

	const settings: DetailSearchLinkerSettings = {
		uiLanguage: enumValue(raw.uiLanguage, ['ja', 'en'], defaultLanguage),
		includeFolders: folderList(raw.includeFolders, DEFAULT_SETTINGS.includeFolders, normalizePath),
		excludeFolders: folderList(raw.excludeFolders, DEFAULT_SETTINGS.excludeFolders, normalizePath),
		scopeMode: enumValue(raw.scopeMode, ['all', 'recent', 'workset', 'recent-workset'], DEFAULT_SETTINGS.scopeMode),
		recentDays: integerValue(raw.recentDays, DEFAULT_SETTINGS.recentDays, INTEGER_SETTING_BOUNDS.recentDays),
		worksetSize: integerValue(raw.worksetSize, DEFAULT_SETTINGS.worksetSize, INTEGER_SETTING_BOUNDS.worksetSize),
		maxFiles: integerValue(raw.maxFiles, DEFAULT_SETTINGS.maxFiles, INTEGER_SETTING_BOUNDS.maxFiles),
		maxFileBytes: integerValue(raw.maxFileBytes, DEFAULT_SETTINGS.maxFileBytes, INTEGER_SETTING_BOUNDS.maxFileBytes),
		caseSensitive: booleanValue(raw.caseSensitive, DEFAULT_SETTINGS.caseSensitive),
		cacheMode: enumValue(raw.cacheMode, ['memory', 'persistent'], DEFAULT_SETTINGS.cacheMode),
		cacheMaxMb: integerValue(raw.cacheMaxMb, DEFAULT_SETTINGS.cacheMaxMb, INTEGER_SETTING_BOUNDS.cacheMaxMb),
		excerptLength: integerValue(raw.excerptLength, DEFAULT_SETTINGS.excerptLength, INTEGER_SETTING_BOUNDS.excerptLength),
		highlightStyle: enumValue(raw.highlightStyle, ['invert', 'marker', 'color', 'underline'], DEFAULT_SETTINGS.highlightStyle),
		showBadge: booleanValue(raw.showBadge, DEFAULT_SETTINGS.showBadge),
		clearOnFileChange: booleanValue(raw.clearOnFileChange, DEFAULT_SETTINGS.clearOnFileChange),
		maxHitsPerNote: integerValue(raw.maxHitsPerNote, DEFAULT_SETTINGS.maxHitsPerNote, INTEGER_SETTING_BOUNDS.maxHitsPerNote),
		maxCandidateNotes: integerValue(raw.maxCandidateNotes, DEFAULT_SETTINGS.maxCandidateNotes, INTEGER_SETTING_BOUNDS.maxCandidateNotes),
		focusedExtraction: booleanValue(raw.focusedExtraction, DEFAULT_SETTINGS.focusedExtraction),
		normalProsePhrases: booleanValue(raw.normalProsePhrases, DEFAULT_SETTINGS.normalProsePhrases),
		broadNgram: booleanValue(raw.broadNgram, DEFAULT_SETTINGS.broadNgram),
		autoMinTermLength: integerValue(raw.autoMinTermLength, DEFAULT_SETTINGS.autoMinTermLength, INTEGER_SETTING_BOUNDS.autoMinTermLength),
		autoMaxTermLength: integerValue(raw.autoMaxTermLength, DEFAULT_SETTINGS.autoMaxTermLength, INTEGER_SETTING_BOUNDS.autoMaxTermLength),
		ngramMinLength: integerValue(raw.ngramMinLength, DEFAULT_SETTINGS.ngramMinLength, INTEGER_SETTING_BOUNDS.ngramMinLength),
		ngramMaxLength: integerValue(raw.ngramMaxLength, DEFAULT_SETTINGS.ngramMaxLength, INTEGER_SETTING_BOUNDS.ngramMaxLength),
		maxAutoQueries: integerValue(raw.maxAutoQueries, DEFAULT_SETTINGS.maxAutoQueries, INTEGER_SETTING_BOUNDS.maxAutoQueries),
		ngramSpanLimit: integerValue(raw.ngramSpanLimit, DEFAULT_SETTINGS.ngramSpanLimit, INTEGER_SETTING_BOUNDS.ngramSpanLimit),
		autoStopWords: trimmedList(raw.autoStopWords, DEFAULT_SETTINGS.autoStopWords),
		ignoredTerms: normalizeIgnoredTerms(
			stringItems(raw.ignoredTerms),
			booleanValue(raw.caseSensitive, DEFAULT_SETTINGS.caseSensitive),
		),
	};

	repairOrderedPair(settings, raw, 'autoMinTermLength', 'autoMaxTermLength');
	repairOrderedPair(settings, raw, 'ngramMinLength', 'ngramMaxLength');
	return settings;
}
