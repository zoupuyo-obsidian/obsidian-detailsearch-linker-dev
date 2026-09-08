import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPaintLockCss } from './paintLock.ts';

test('paint lock CSS hides marks on editors that do not carry the current token', () => {
	const css = buildPaintLockCss(7);
	assert.match(css, /data-dsl-paint="7"/);
	assert.match(css, /\.cm-editor:not\(\[data-dsl-paint\]\)/);
	assert.match(css, /\.cm-editor\[data-dsl-paint\]:not\(\[data-dsl-paint="7"\]\)/);
	assert.match(css, /transparent/);
});
