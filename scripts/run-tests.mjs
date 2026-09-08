import { spawn } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';

const node = process.execPath;
const outputDir = '.test-dist';

async function run(args) {
	return await new Promise((resolve, reject) => {
		const child = spawn(node, args, { stdio: 'inherit', shell: false });
		child.on('error', reject);
		child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
	});
}

async function* walkAll(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) yield* walkAll(path);
		else if (entry.isFile()) yield path;
	}
}

await rm(outputDir, { recursive: true, force: true });
let code = await run(['node_modules/typescript/bin/tsc', '--project', 'tsconfig.test.json', '--noCheck']);
if (code !== 0) process.exit(code);

const testFiles = [];
for (const dir of [`${outputDir}/src`, `${outputDir}/scripts`]) {
	for await (const file of walkAll(dir)) {
		if (file.endsWith('.test.js')) testFiles.push(file);
	}
}
testFiles.sort();

// The source tree intentionally uses extensionless relative imports for esbuild.
// Add .js only in the disposable test output so Node's ESM loader can resolve it.
for (const dir of [`${outputDir}/src`, `${outputDir}/scripts`]) {
	for await (const file of walkAll(dir)) {
		const source = await readFile(file, 'utf8');
	const rewritten = source.replace(
		/(from\s+['"])(\.\.?\/[^'"\n]+?)(['"])/g,
		(_match, prefix, specifier, suffix) =>
			/\.[cm]?js$/.test(specifier) ? `${prefix}${specifier}${suffix}` : `${prefix}${specifier}.js${suffix}`,
	);
		if (rewritten !== source) await writeFile(file, rewritten);
	}
}
code = await run(['--experimental-specifier-resolution=node', '--test', ...testFiles]);
process.exit(code);
