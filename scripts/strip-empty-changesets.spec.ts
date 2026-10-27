import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isEmptyChangeset, stripEmptyChangesets } from './strip-empty-changesets.mjs';

const created: string[] = [];

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'changesets-'));
  created.push(dir);
  return dir;
};

const changeset = (frontmatter: string): string => `---\n${frontmatter}\n---\n\nsummary\n`;

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('changesets that declare a release', () => {
  it.each([
    ['single-quoted', "'@naulabsco/auth-core': minor"],
    ['double-quoted', '"@naulabsco/auth-core": minor'],
    ['unquoted', '@naulabsco/auth-core: minor'],
    ['multi-package', "'@naulabsco/auth-core': minor\n'@naulabsco/config': patch"],
  ])('keeps a %s package key', (_label, frontmatter) => {
    expect(isEmptyChangeset(changeset(frontmatter))).toBe(false);
  });
});

describe('empty changesets', () => {
  it('treats frontmatter with no release as empty', () => {
    expect(isEmptyChangeset('---\n\n---\n')).toBe(true);
    expect(isEmptyChangeset('---\n\n---\n\nGate-only: publish under the scope first.\n')).toBe(true);
  });

  it('treats whitespace and comments as empty', () => {
    expect(isEmptyChangeset('---\n  \n# nothing ships yet\n---\n\nsummary\n')).toBe(true);
  });

  it('keeps a file that is not a changeset at all', () => {
    expect(isEmptyChangeset('# Changesets\n\nRun `pnpm exec changeset`.\n')).toBe(false);
  });

  it('removes only empty changesets, leaving releases and config alone', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'empty.md'), '---\n\n---\n');
    await writeFile(join(dir, 'release.md'), changeset("'@naulabsco/config': patch"));
    await writeFile(join(dir, 'config.json'), '{}');

    expect(stripEmptyChangesets(dir)).toEqual(['empty.md']);
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({});
    await expect(readFile(join(dir, 'empty.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(dir, 'release.md'), 'utf8')).toContain('@naulabsco/config');
  });
});
