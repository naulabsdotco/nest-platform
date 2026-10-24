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

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('empty changesets', () => {
  it('treats frontmatter with no release as empty', () => {
    expect(isEmptyChangeset('---\n\n---\n')).toBe(true);
    expect(isEmptyChangeset('---\n"@naulabsco/config": patch\n---\n\nfix\n')).toBe(false);
  });

  it('removes only empty changesets, leaving releases and config alone', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'empty.md'), '---\n\n---\n');
    await writeFile(join(dir, 'release.md'), '---\n"@naulabsco/config": patch\n---\n\nfix\n');
    await writeFile(join(dir, 'config.json'), '{}');

    expect(stripEmptyChangesets(dir)).toEqual(['empty.md']);
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({});
    await expect(readFile(join(dir, 'empty.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(dir, 'release.md'), 'utf8')).toContain('@naulabsco/config');
  });
});
