import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
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

await rm(outputDir, { recursive: true, force: true });
let code = await run(['node_modules/typescript/bin/tsc', '--project', 'tsconfig.test.json', '--noCheck']);
if (code !== 0) process.exit(code);

const testFiles = [];
for await (const file of glob(`${outputDir}/{src,scripts}/**/*.test.js`)) {
	testFiles.push(file);
}
testFiles.sort();

// The source tree intentionally uses extensionless relative imports for esbuild.
// Add .js only in the disposable test output so Node's ESM loader can resolve it.
for await (const file of glob(`${outputDir}/{src,scripts}/**/*.js`)) {
	const source = await readFile(file, 'utf8');
	const rewritten = source.replace(
		/(from\s+['"])(\.\.?\/[^'"\n]+?)(['"])/g,
		(_match, prefix, specifier, suffix) =>
			/\.[cm]?js$/.test(specifier) ? `${prefix}${specifier}${suffix}` : `${prefix}${specifier}.js${suffix}`,
	);
	if (rewritten !== source) await writeFile(file, rewritten);
}
code = await run(['--experimental-specifier-resolution=node', '--test', ...testFiles]);
process.exit(code);
