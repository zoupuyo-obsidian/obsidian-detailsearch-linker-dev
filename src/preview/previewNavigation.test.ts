import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	beginPreviewNavigation,
	previewOpenNeedsDetachedEditor,
	resolvePreviewOpenStrategy,
	shouldApplySessionToLeaf,
	transitionPreviewNavigation,
} from './previewNavigation.ts';

const navigation = {
	sourcePath: 'source.md',
	targetPath: 'target.md',
};

test('target file-open preserves preview navigation', () => {
	assert.deepEqual(transitionPreviewNavigation(navigation, 'target.md'), {
		state: navigation,
		action: 'preserve',
	});
});

test('source file-open restores the source and ends preview navigation', () => {
	assert.deepEqual(transitionPreviewNavigation(navigation, 'source.md'), {
		state: null,
		action: 'restore-source',
	});
});

test('source file-open during preview open is the cloned tab, not a return', () => {
	for (const path of ['source.md', 'third.md', null]) {
		assert.deepEqual(transitionPreviewNavigation(navigation, path, true), {
			state: navigation,
			action: 'preserve',
		});
	}
	assert.deepEqual(
		transitionPreviewNavigation(navigation, 'target.md', true),
		{ state: navigation, action: 'preserve' },
	);
});

test('unrelated and null file-open clear and end preview navigation', () => {
	for (const path of ['third.md', null]) {
		assert.deepEqual(transitionPreviewNavigation(navigation, path), {
			state: null,
			action: 'clear',
		});
	}
});

test('preview navigation is not started for invalid or identical paths', () => {
	assert.equal(beginPreviewNavigation('', 'target.md'), null);
	assert.equal(beginPreviewNavigation('source.md', ''), null);
	assert.equal(beginPreviewNavigation('source.md', 'source.md'), null);
	assert.deepEqual(beginPreviewNavigation('source.md', 'target.md'), navigation);
});

test('preview open prefers an existing target leaf over the source editor', () => {
	assert.deepEqual(
		resolvePreviewOpenStrategy(
			[{ path: 'source.md' }, { path: 'target.md' }, { path: 'other.md' }],
			'target.md',
		),
		{ kind: 'existing', leafIndex: 1 },
	);
});

test('preview open uses a new tab when the target is not already visible', () => {
	assert.deepEqual(
		resolvePreviewOpenStrategy([{ path: 'source.md' }], 'target.md'),
		{ kind: 'new-tab' },
	);
});

test('a new-tab open must detach the duplicated editor before loading the target', () => {
	assert.equal(previewOpenNeedsDetachedEditor({ kind: 'new-tab' }), true);
	assert.equal(
		previewOpenNeedsDetachedEditor({ kind: 'existing', leafIndex: 0 }),
		false,
	);
});

test('session paint stays on the source document and never on a preview target', () => {
	const source = {
		sessionFilePath: 'source.md',
		leafFilePath: 'source.md',
		previewTargetPath: 'target.md' as string | null,
		leafIsPendingPreviewOpen: false,
		documentMatchesSession: true,
	};
	assert.equal(shouldApplySessionToLeaf(source), false);
	assert.equal(
		shouldApplySessionToLeaf({ ...source, editorAlreadyAllowed: true }),
		true,
	);
	assert.equal(
		shouldApplySessionToLeaf({
			...source,
			previewTargetPath: null,
			editorAlreadyAllowed: false,
		}),
		true,
	);
	assert.equal(
		shouldApplySessionToLeaf({ ...source, leafFilePath: 'target.md' }),
		false,
	);
	assert.equal(
		shouldApplySessionToLeaf({ ...source, leafIsPendingPreviewOpen: true }),
		false,
	);
	assert.equal(
		shouldApplySessionToLeaf({ ...source, documentMatchesSession: false }),
		false,
	);
	assert.equal(
		shouldApplySessionToLeaf({ ...source, sessionFilePath: '' }),
		false,
	);
	assert.equal(
		shouldApplySessionToLeaf({
			...source,
			openingPreview: true,
			editorAlreadyAllowed: true,
		}),
		true,
	);
	assert.equal(
		shouldApplySessionToLeaf({
			...source,
			openingPreview: true,
			editorAlreadyAllowed: false,
		}),
		false,
	);
});
