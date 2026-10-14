import { describe, expect, it } from 'vitest';
import { SOURCE_CONDITION, publishManifest } from './publish-manifest.mjs';

const devManifest = {
  name: '@naulabs/config',
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
});
