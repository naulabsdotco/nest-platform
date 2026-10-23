import { describe, expect, it } from 'vitest';
import { SOURCE_CONDITION, publishManifest } from './publish-manifest.mjs';

const devManifest = {
  name: '@naulabsco/config',
  files: ['dist', 'src'],
  exports: {
    '.': {
      [SOURCE_CONDITION]: './src/index.ts',
      import: { types: './dist/esm/index.d.ts', default: './dist/esm/index.js' },
      require: { types: './dist/cjs/index.d.cts', default: './dist/cjs/index.js' },
    },
    './package.json': './package.json',
  },
};

const workspaceManifest = {
  name: '@naulabsco/auth-core',
  version: '0.0.0',
  files: ['dist', 'src'],
  dependencies: { '@naulabsco/errors': 'workspace:*', argon2: '^0.45.1' },
  peerDependencies: { zod: 'workspace:^' },
  exports: { '.': { [SOURCE_CONDITION]: './src/index.ts' } },
};

describe('publishManifest', () => {
  it('drops the source condition from the published entry', () => {
    expect(publishManifest(devManifest).exports['.']).not.toHaveProperty(SOURCE_CONDITION);
  });

  it('drops src from the published files', () => {
    expect(publishManifest(devManifest).files).toEqual(['dist']);
  });

  it('leaves the dev manifest unchanged', () => {
    publishManifest(devManifest);

    expect(devManifest.files).toEqual(['dist', 'src']);
    expect(devManifest.exports['.']).toHaveProperty(SOURCE_CONDITION);
  });

  it('resolves a workspace range to the package version a consumer can install', () => {
    const published = publishManifest(workspaceManifest);

    expect(published.dependencies?.['@naulabsco/errors']).toBe('0.0.0');
    expect(published.dependencies?.argon2).toBe('^0.45.1');
    expect(workspaceManifest.dependencies?.['@naulabsco/errors']).toBe('workspace:*');
  });

  it('keeps a caret workspace range a caret and a pinned range pinned', () => {
    const published = publishManifest({ ...workspaceManifest, version: '1.2.3' });

    expect(published.peerDependencies?.zod).toBe('^1.2.3');
  });
});
