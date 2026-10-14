import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPackage } from '../tools/build.mjs';

const fixture = join(process.cwd(), '.build-fixture');
const load = createRequire(import.meta.url);
const output = (file: string): string => readFileSync(join(fixture, file), 'utf8');

describe('buildPackage', () => {
  beforeAll(async () => {
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(join(fixture, 'src'), { recursive: true });
    writeFileSync(
      join(fixture, 'tsconfig.json'),
      '{ "compilerOptions": { "strict": true, "skipLibCheck": true, "module": "ESNext", "moduleResolution": "bundler", "target": "ES2022" } }\n',
    );
    writeFileSync(
      join(fixture, 'src/index.ts'),
      "import globals from 'globals';\nexport const surface = { a: 1 };\nexport const nodeGlobals = globals.node;\n",
    );
    await buildPackage(fixture);
  }, 60_000);

  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  it('emits ESM and CJS with declarations, source maps and a CJS marker', () => {
    const files = [
      'dist/esm/index.js',
      'dist/esm/index.d.ts',
      'dist/esm/index.js.map',
      'dist/cjs/index.js',
      'dist/cjs/index.d.cts',
      'dist/cjs/index.js.map',
      'dist/cjs/package.json',
    ];

    for (const file of files) expect(existsSync(join(fixture, file)), file).toBe(true);
  });

  it('keeps a node_modules dependency external in both formats', () => {
    expect(output('dist/esm/index.js')).toMatch(/from\s*["']globals["']/);
    expect(output('dist/cjs/index.js')).toMatch(/require\(\s*["']globals["']\s*\)/);
  });

  it('resolves the same surface under import and require', async () => {
    const esm = await import(pathToFileURL(join(fixture, 'dist/esm/index.js')).href);
    const cjs = load(join(fixture, 'dist/cjs/index.js'));

    expect(Object.keys(esm).sort()).toEqual(Object.keys(cjs).sort());
    expect(esm.surface).toEqual({ a: 1 });
  });
});
