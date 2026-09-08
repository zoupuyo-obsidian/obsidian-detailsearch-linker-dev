import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PreviewHost } from '../../preview/hoverPreview.ts';
import { emptySession } from '../../session.ts';

test('PreviewHost ignoreTerm callback receives query and session groupKey', () => {
	let receivedQuery = '';
	let receivedKey = '';
	const host: PreviewHost = {
		getLang: () => 'en',
		getSession: () => emptySession(),
		createLink: () => {},
		openNote: () => {},
		clearSession: () => {},
		hasActiveSession: () => false,
		ignoreTerm: (query, groupKey) => {
			receivedQuery = query;
			receivedKey = groupKey;
		},
		resolveExcerpt: (hit) => hit.excerpt,
	};
	host.ignoreTerm('Foo', 'foo');
	assert.equal(receivedQuery, 'Foo');
	assert.equal(receivedKey, 'foo');
});
