import { readFile } from 'node:fs/promises';
import { writeReleaseChecksums } from './releaseIntegrity.mjs';

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

const [packageJson, manifest, versions] = await Promise.all([
	readJson('package.json'),
	readJson('manifest.json'),
	readJson('versions.json'),
]);

if (packageJson.version !== manifest.version) {
	throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`);
}
if (versions[manifest.version] !== manifest.minAppVersion) {
	throw new Error(
		`versions.json must map ${manifest.version} to manifest minAppVersion ${manifest.minAppVersion}`,
	);
}

for (const field of ['id', 'name', 'author']) {
	if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
		throw new Error(`manifest.json ${field} must be a non-empty string`);
	}
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
	throw new Error('manifest.json id must contain only lowercase letters, numbers, and hyphens');
}

const checksums = await writeReleaseChecksums('.');
console.log(`Release metadata verified for ${manifest.id} ${manifest.version}`);
console.log(checksums.trimEnd());
