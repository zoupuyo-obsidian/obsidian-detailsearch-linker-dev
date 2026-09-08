import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILD_ARTIFACT_MARKERS } from './core/commands/commandRegistry.ts';

test('build artifact markers are defined for bundle verification', () => {
	assert.equal(BUILD_ARTIFACT_MARKERS.commandId, 'search-current-note');
	assert.equal(BUILD_ARTIFACT_MARKERS.jaLabel, '現在ノートの本文リンク候補を探す');
	assert.equal(
		BUILD_ARTIFACT_MARKERS.enLabel,
		'Find body link candidates in current note',
	);
});
