import { mkdir, writeFile } from 'node:fs/promises';
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
      // A node_modules dependency stays external; bundling one can pull in its optional peers.
      skipNodeModulesBundle: true,
      tsconfig: join(dir, 'tsconfig.json'),
      // tsup would name the CJS entry index.cjs; the exports map points require at index.js,
      // and dist/cjs/package.json marks the folder CommonJS.
      outExtension: () => ({ js: '.js' }),
    });
  }
  const cjsDir = join(dir, 'dist/cjs');
  await mkdir(cjsDir, { recursive: true });
  await writeFile(join(cjsDir, 'package.json'), '{ "type": "commonjs" }\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildPackage(process.argv[2] ?? process.cwd());
}
