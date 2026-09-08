import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];
export const CHECKSUM_FILE = 'SHA256SUMS';

export function sha256Hex(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

export function formatSha256Sums(entries) {
	return `${entries.map(({ hash, name }) => `${hash}  ${name}`).join('\n')}\n`;
}

export async function hashReleaseFiles(rootDir) {
	const entries = [];
	for (const name of RELEASE_FILES) {
		const contents = await readFile(path.join(rootDir, name));
		if (contents.length === 0) {
			throw new Error(`${name} must not be empty`);
		}
		entries.push({ name, hash: sha256Hex(contents) });
	}
	return entries;
}

export async function writeReleaseChecksums(rootDir) {
	const sums = formatSha256Sums(await hashReleaseFiles(rootDir));
	await writeFile(path.join(rootDir, CHECKSUM_FILE), sums);
	return sums;
}
