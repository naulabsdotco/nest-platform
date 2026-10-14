import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';

// tsup emits one format per run; the two runs land in dist/esm and dist/cjs so the
// exports map can point `import` and `require` at the same surface.
const formats = [
  { format: 'esm', outDir: 'esm' },
  { format: 'cjs', outDir: 'cjs' },
];

export async function buildPackage(dir) {
  for (const { format, outDir } of formats) {
    await build({
      entry: [join(dir, 'src/index.ts')],
      outDir: join(dir, 'dist', outDir),
      format,
      dts: true,
      sourcemap: true,
      clean: true,
      silent: true,
    });
  }
  // Without this marker Node reads dist/cjs/index.js as ESM under a "type": "module" package.
  const cjsDir = join(dir, 'dist/cjs');
  await mkdir(cjsDir, { recursive: true });
  await writeFile(join(cjsDir, 'package.json'), '{ "type": "commonjs" }\n');
}

const packageDirs = async (root) => {
  const entries = await readdir(join(root, 'packages'), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, 'packages', entry.name));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  for (const dir of await packageDirs(root)) await buildPackage(dir);
}
