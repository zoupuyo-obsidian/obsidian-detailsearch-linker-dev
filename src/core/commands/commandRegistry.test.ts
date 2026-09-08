import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BUILD_ARTIFACT_MARKERS,
	COMMAND_DEFINITIONS,
	REGISTERED_COMMAND_IDS,
	SEARCH_CURRENT_NOTE_COMMAND_ID,
	primaryCommandDefinition,
} from './commandRegistry.ts';

test('primary command is search-current-note with search icon', () => {
	const primary = primaryCommandDefinition();
	assert.equal(primary.id, SEARCH_CURRENT_NOTE_COMMAND_ID);
	assert.equal(primary.id, 'search-current-note');
	assert.equal(primary.icon, 'search');
	assert.equal(primary.i18nKey, 'cmdSearchCurrentNote');
	assert.equal(primary.primary, true);
});

test('legacy diagnostic commands remain registered', () => {
	assert.deepEqual(
		COMMAND_DEFINITIONS.map((c) => c.id),
		[...REGISTERED_COMMAND_IDS],
	);
	assert.ok(COMMAND_DEFINITIONS.some((c) => c.id === 'search-selection'));
	assert.ok(COMMAND_DEFINITIONS.some((c) => c.id === 'search-auto'));
	assert.ok(COMMAND_DEFINITIONS.some((c) => c.id === 'search-clipboard'));
	assert.ok(
		COMMAND_DEFINITIONS.some((c) => c.id === 'open-candidates-at-cursor'),
	);
	assert.ok(COMMAND_DEFINITIONS.some((c) => c.id === 'go-to-next-highlight'));
	assert.ok(
		COMMAND_DEFINITIONS.some((c) => c.id === 'go-to-previous-highlight'),
	);
	assert.equal(
		COMMAND_DEFINITIONS.find((c) => c.id === 'open-candidates-at-cursor')?.icon,
		undefined,
	);
	assert.equal(COMMAND_DEFINITIONS.filter((c) => c.primary).length, 1);
	assert.equal(COMMAND_DEFINITIONS[0]!.id, SEARCH_CURRENT_NOTE_COMMAND_ID);
});

test('build artifact markers match i18n strings', () => {
	assert.equal(BUILD_ARTIFACT_MARKERS.commandId, 'search-current-note');
	assert.equal(BUILD_ARTIFACT_MARKERS.jaLabel, '現在ノートの本文リンク候補を探す');
	assert.equal(
		BUILD_ARTIFACT_MARKERS.enLabel,
		'Find body link candidates in current note',
	);
});
