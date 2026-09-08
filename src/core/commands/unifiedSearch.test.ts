import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	hasNonEmptySelection,
	resolveRibbonAction,
	resolveUnifiedCommandBranch,
} from './unifiedSearch.ts';

test('resolveUnifiedCommandBranch uses selection when trimmed non-empty', () => {
	assert.equal(resolveUnifiedCommandBranch('  term  '), 'selection');
	assert.equal(resolveUnifiedCommandBranch('認知負荷'), 'selection');
});

test('resolveUnifiedCommandBranch uses auto when selection empty or whitespace', () => {
	assert.equal(resolveUnifiedCommandBranch(''), 'auto');
	assert.equal(resolveUnifiedCommandBranch('   '), 'auto');
	assert.equal(resolveUnifiedCommandBranch('\n'), 'auto');
});

test('resolveRibbonAction prefers selection over active session', () => {
	assert.equal(resolveRibbonAction('term', true), 'selection');
	assert.equal(resolveRibbonAction('  x  ', true), 'selection');
});

test('resolveRibbonAction clears when no selection and session active', () => {
	assert.equal(resolveRibbonAction('', true), 'clear');
	assert.equal(resolveRibbonAction('  ', true), 'clear');
});

test('resolveRibbonAction auto-extracts when no selection and no session', () => {
	assert.equal(resolveRibbonAction('', false), 'auto');
	assert.equal(resolveRibbonAction('  ', false), 'auto');
});

test('hasNonEmptySelection respects trim', () => {
	assert.equal(hasNonEmptySelection('a'), true);
	assert.equal(hasNonEmptySelection('  a '), true);
	assert.equal(hasNonEmptySelection(''), false);
	assert.equal(hasNonEmptySelection('\t'), false);
});
