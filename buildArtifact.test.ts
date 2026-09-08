import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILD_ARTIFACT_MARKERS } from './core/commands/commandRegistry.ts';

test('build artifact markers are defined for bundle verification', () => {
	assert.equal(BUILD_ARTIFACT_MARKERS.commandId, 'search-current-note');
	assert.equal(BUILD_ARTIFACT_MARKERS.jaLabel, 'DSL: 全体から検索');
	assert.equal(
		BUILD_ARTIFACT_MARKERS.enLabel,
		'DSL: Search all',
	);
});
