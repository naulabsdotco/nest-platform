import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPackage } from '../tools/build.mjs';

const fixture = join(process.cwd(), '.build-fixture');
const load = createRequire(import.meta.url);

describe('buildPackage', () => {
  beforeAll(async () => {
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(join(fixture, 'src'), { recursive: true });
    writeFileSync(join(fixture, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n');
    writeFileSync(join(fixture, 'src/index.ts'), 'export const surface = { a: 1 };\n');
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

  it('resolves the same surface under import and require', async () => {
    const esm = await import(pathToFileURL(join(fixture, 'dist/esm/index.js')).href);
    const cjs = load(join(fixture, 'dist/cjs/index.js'));

    expect(Object.keys(esm).sort()).toEqual(Object.keys(cjs).sort());
    expect(esm.surface).toEqual({ a: 1 });
  });
});
