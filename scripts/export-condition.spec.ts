import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGES, checkExports, readPackageJson } from './export-conditions.mjs';

const root = process.cwd();
const packageDir = (name: string): string => join(root, 'packages', name);
const load = createRequire(import.meta.url);

describe('package export conditions', () => {
  it('resolves through the @naulabs/source condition in dev', () => {
    for (const name of PACKAGES) {
      const pkg = readPackageJson(packageDir(name));

      expect(pkg.exports['.']['@naulabs/source']).toBe('./src/index.ts');
      expect(existsSync(join(packageDir(name), 'src/index.ts'))).toBe(true);
    }
  });

  it('resolves through both the import and require conditions after a build', () => {
    for (const name of PACKAGES) {
      const { exports } = readPackageJson(packageDir(name));

      expect(existsSync(join(packageDir(name), exports['.'].import.default))).toBe(true);
      expect(existsSync(join(packageDir(name), exports['.'].require.default))).toBe(true);
      expect(checkExports(name, { exports })).toEqual([]);
    }
  });

  it('exposes the same export names from the ESM and CJS builds', async () => {
    for (const name of PACKAGES) {
      const esm = await import(/* @vite-ignore */ `@naulabs/${name}`);
      const cjs = load(`@naulabs/${name}`);

      expect(Object.keys(cjs).sort()).toEqual(Object.keys(esm).sort());
    }
  });

  it('fails a package without a dist fallback', () => {
    const broken = {
      exports: {
        '.': {
          '@naulabs/source': './src/index.ts',
          import: { types: './dist/esm/index.d.ts', default: './dist/esm/index.js' },
        },
      },
    };

    expect(checkExports('broken', broken)).not.toEqual([]);
  });
});
