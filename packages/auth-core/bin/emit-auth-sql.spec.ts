import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emitAuthSql } from './emit-auth-sql.mjs';

const UTC14 = '20260101000000';
let created: string | undefined;

const destination = async (): Promise<string> => {
  created = await mkdtemp(join(tmpdir(), 'auth-core-emit-'));
  return created;
};

afterEach(async () => {
  if (created !== undefined) await rm(created, { recursive: true, force: true });
  created = undefined;
});

const sourceOf = (name: string): Promise<string> => readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8');

describe('emitAuthSql', () => {
  it('writes <utc14>_<name>.sql and does not run them', async () => {
    const destDir = await destination();

    const written = await emitAuthSql({ destDir, utc14: UTC14 });

    expect(written.map((path) => basename(path)).sort()).toEqual([
      `${UTC14}_login_attempt.sql`,
      `${UTC14}_password_reset_token.sql`,
      `${UTC14}_refresh_token.sql`,
      `${UTC14}_subject.sql`,
      `${UTC14}_subject_credential.sql`,
    ]);
    expect(await readFile(join(destDir, `${UTC14}_subject.sql`), 'utf8')).toBe(
      await sourceOf('0001_subject.sql'),
    );
  });

  it('a second emit refuses to overwrite', async () => {
    const destDir = await destination();
    await emitAuthSql({ destDir, utc14: UTC14 });
    const target = join(destDir, `${UTC14}_subject.sql`);
    await writeFile(target, '-- kept\n');

    await expect(emitAuthSql({ destDir, utc14: UTC14 })).rejects.toThrow(/overwrite/i);
    expect(await readFile(target, 'utf8')).toBe('-- kept\n');
  });

  it('the emitted set contains forward SQL only', async () => {
    const destDir = await destination();

    const written = await emitAuthSql({ destDir, utc14: UTC14 });

    expect(written).toHaveLength(5);
    for (const path of written) {
      expect(basename(path).startsWith(`${UTC14}_`)).toBe(true);
      expect(await readFile(path, 'utf8')).not.toMatch(/\b(drop|truncate|delete\s+from)\b/i);
    }
  });

  it('refuses a utc14 that is not 14 digits', async () => {
    const destDir = await destination();

    await expect(emitAuthSql({ destDir, utc14: '2026' })).rejects.toThrow(/utc14/i);
  });
});
