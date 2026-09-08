import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySession, type DetailSessionState } from './session.ts';
import {
	SessionController,
	preferSession,
	shouldAdoptEditorSession,
} from './sessionController.ts';

function session(path: string, anchors = 1): DetailSessionState {
	return {
		...emptySession(),
		filePath: path,
		anchors: Array.from({ length: anchors }, (_, i) => ({
			id: `a${i}`,
			from: i,
			to: i + 1,
			text: 't',
			groupKey: 'g',
		})),
	};
}

test('preferSession uses the editor session when it has a filePath', () => {
	const canonical = session('a.md', 2);
	const live = session('a.md', 1);
	assert.equal(preferSession(canonical, live, 'a.md'), live);
});

test('preferSession falls back to the painted session for the same note', () => {
	const canonical = session('a.md');
	assert.equal(preferSession(canonical, null, 'a.md'), canonical);
	assert.equal(preferSession(canonical, emptySession(), 'a.md'), canonical);
});

test('preferSession returns empty when the active note is not the painted note', () => {
	const canonical = session('a.md');
	assert.deepEqual(preferSession(canonical, null, 'b.md'), emptySession());
	assert.deepEqual(preferSession(canonical, null, undefined), emptySession());
});

test('shouldAdoptEditorSession requires the same path and a matching document', () => {
	const canonical = session('a.md');
	assert.equal(shouldAdoptEditorSession(canonical, session('a.md'), true), true);
	assert.equal(shouldAdoptEditorSession(canonical, session('a.md'), false), false);
	assert.equal(shouldAdoptEditorSession(canonical, session('b.md'), true), false);
	assert.equal(shouldAdoptEditorSession(canonical, null, true), false);
	assert.equal(shouldAdoptEditorSession(canonical, emptySession(), true), false);
});

test('SessionController is the only writable session owner', () => {
	const controller = new SessionController();
	assert.equal(controller.hasActive(), false);
	const painted = session('note.md', 2);
	controller.replace(painted);
	assert.equal(controller.get(), painted);
	assert.equal(controller.hasActive(), true);
	assert.equal(controller.prefer(null, 'note.md'), painted);

	const mapped = session('note.md', 1);
	assert.equal(controller.adoptEditorSession(mapped, true), true);
	assert.equal(controller.get(), mapped);
	assert.equal(controller.adoptEditorSession(session('other.md'), true), false);
	assert.equal(controller.get(), mapped);

	controller.update((current) => ({
		...current,
		anchors: current.anchors.filter((item) => item.id !== 'a0'),
	}));
	assert.equal(controller.get().anchors.length, 0);
	assert.equal(controller.hasActive(), false);
	controller.clear();
	assert.deepEqual(controller.get(), emptySession());
});
