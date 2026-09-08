import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSha256Sums, sha256Hex } from './releaseIntegrity.mjs';

test('sha256Hex matches the FIPS 180-2 abc vector', () => {
	assert.equal(
		sha256Hex(Buffer.from('abc')),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	);
});

test('formatSha256Sums writes coreutils-compatible two-space lines', () => {
	assert.equal(
		formatSha256Sums([
			{ hash: 'abc', name: 'main.js' },
			{ hash: 'def', name: 'styles.css' },
		]),
		'abc  main.js\ndef  styles.css\n',
	);
});
