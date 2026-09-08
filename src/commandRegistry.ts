/** Primary unified command — must appear in built main.js (see buildArtifact.test.ts). */
export const SEARCH_CURRENT_NOTE_COMMAND_ID = 'search-current-note';

export const LEGACY_COMMAND_IDS = ['search-selection', 'search-auto', 'search-clipboard'] as const;

export const ACCESSIBILITY_COMMAND_IDS = [
	'open-candidates-at-cursor',
	'go-to-next-highlight',
	'go-to-previous-highlight',
] as const;

export const DIAGNOSTIC_COMMAND_IDS = [
	'cancel-search',
	'clear-highlights',
	'clear-cache',
] as const;

export const REGISTERED_COMMAND_IDS = [
	SEARCH_CURRENT_NOTE_COMMAND_ID,
	...LEGACY_COMMAND_IDS,
	...ACCESSIBILITY_COMMAND_IDS,
	...DIAGNOSTIC_COMMAND_IDS,
] as const;

/** Embedded in bundle for post-build grep verification. */
export const BUILD_ARTIFACT_MARKERS = {
	commandId: SEARCH_CURRENT_NOTE_COMMAND_ID,
	jaLabel: 'DSL: 全体から検索',
	enLabel: 'DSL: Search all',
} as const;

export type CommandI18nKey =
	| 'cmdSearchCurrentNote'
	| 'cmdSearchSelection'
	| 'cmdSearchAuto'
	| 'cmdSearchClipboard'
	| 'cmdOpenCandidatesAtCursor'
	| 'cmdGoToNextHighlight'
	| 'cmdGoToPreviousHighlight'
	| 'cmdCancelSearch'
	| 'cmdClear'
	| 'cmdClearCache';

export interface CommandDefinition {
	id: string;
	i18nKey: CommandI18nKey;
	icon?: string;
	primary: boolean;
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
	{
		id: SEARCH_CURRENT_NOTE_COMMAND_ID,
		i18nKey: 'cmdSearchCurrentNote',
		icon: 'search',
		primary: true,
	},
	{ id: 'search-selection', i18nKey: 'cmdSearchSelection', primary: false },
	{ id: 'search-auto', i18nKey: 'cmdSearchAuto', primary: false },
	{ id: 'search-clipboard', i18nKey: 'cmdSearchClipboard', primary: false },
	{
		id: 'open-candidates-at-cursor',
		i18nKey: 'cmdOpenCandidatesAtCursor',
		primary: false,
	},
	{
		id: 'go-to-next-highlight',
		i18nKey: 'cmdGoToNextHighlight',
		primary: false,
	},
	{
		id: 'go-to-previous-highlight',
		i18nKey: 'cmdGoToPreviousHighlight',
		primary: false,
	},
	{ id: 'cancel-search', i18nKey: 'cmdCancelSearch', primary: false },
	{ id: 'clear-highlights', i18nKey: 'cmdClear', primary: false },
	{ id: 'clear-cache', i18nKey: 'cmdClearCache', primary: false },
];

export function primaryCommandDefinition(): CommandDefinition {
	const primary = COMMAND_DEFINITIONS.find((c) => c.primary);
	if (!primary) {
		throw new Error('primary command definition missing');
	}
	return primary;
}
