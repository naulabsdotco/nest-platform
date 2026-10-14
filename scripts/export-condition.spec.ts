import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGES, checkExports, readPackageJson, typeMismatches } from './export-conditions.mjs';

const root = process.cwd();
const packageDir = (name: string): string => join(root, 'packages', name);
const load = createRequire(import.meta.url);
const resolveWith = (name: string): string =>
  execFileSync('node', ['--conditions=@naulabs/source', '-p', `require.resolve('@naulabs/${name}')`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

describe('package export conditions', () => {
  it('resolves through the @naulabs/source condition in dev', () => {
    for (const name of PACKAGES) {
      expect(resolveWith(name)).toBe(join(packageDir(name), 'src/index.ts'));
    }
  });

  it('resolves through both the import and require conditions after a build', () => {
    for (const name of PACKAGES) {
      const pkg = readPackageJson(packageDir(name));

      expect(checkExports(name, pkg, packageDir(name))).toEqual([]);
    }
  });

  it('exposes the same non-empty surface with matching export types', async () => {
    for (const name of PACKAGES) {
      const esm = await import(/* @vite-ignore */ `@naulabs/${name}`);
      const cjs = load(`@naulabs/${name}`);

      expect(Object.keys(esm).length).toBeGreaterThan(0);
      expect(Object.keys(cjs).sort()).toEqual(Object.keys(esm).sort());
      expect(typeMismatches(esm, cjs)).toEqual([]);
    }
  });

  it('flags an export whose type differs between the builds', () => {
    expect(typeMismatches({ name: 'x', count: 1 }, { name: 'x', count: '1' })).toEqual(['count: number vs string']);
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

    expect(checkExports('broken', broken, packageDir('config'))).not.toEqual([]);
  });
});
