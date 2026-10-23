import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitAuthSql } from './emit-auth-sql.mjs';

const faults = vi.hoisted(() => ({ failOn: undefined as string | undefined }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (path: string | URL, data: string, options?: unknown) => {
      if (faults.failOn !== undefined && String(path).includes(faults.failOn)) {
        throw new Error('disk full');
      }
      return (actual.writeFile as unknown as (...args: unknown[]) => Promise<void>)(path, data, options);
    },
  };
});

const UTC14 = '20260101000000';
const run = promisify(execFile);
const created: string[] = [];

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'auth-core-emit-'));
  created.push(dir);
  return dir;
};

afterEach(async () => {
  faults.failOn = undefined;
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const sourceOf = (name: string): Promise<string> => readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8');

describe('emitAuthSql', () => {
  it('writes <utc14>_<name>.sql and does not run them', async () => {
    const destDir = await tempDir();

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

  it('runs through a node_modules/.bin-style symlink', async () => {
    const destDir = await tempDir();
    const linkDir = await tempDir();
    const link = join(linkDir, 'emit-auth-sql');
    await symlink(fileURLToPath(new URL('./emit-auth-sql.mjs', import.meta.url)), link);

    const { stdout } = await run(process.execPath, [link, '--dest', destDir, '--utc14', UTC14]);

    expect(stdout).toContain(`${UTC14}_subject.sql`);
    expect((await readdir(destDir)).sort()).toEqual([
      `${UTC14}_login_attempt.sql`,
      `${UTC14}_password_reset_token.sql`,
      `${UTC14}_refresh_token.sql`,
      `${UTC14}_subject.sql`,
      `${UTC14}_subject_credential.sql`,
    ]);
  });

  it('a second emit refuses to overwrite', async () => {
    const destDir = await tempDir();
    await emitAuthSql({ destDir, utc14: UTC14 });
    const target = join(destDir, `${UTC14}_subject.sql`);
    await writeFile(target, '-- kept\n');

    await expect(emitAuthSql({ destDir, utc14: UTC14 })).rejects.toThrow(/overwrite/i);
    expect(await readFile(target, 'utf8')).toBe('-- kept\n');
  });

  it('a write failure removes the files this run created', async () => {
    const destDir = await tempDir();
    faults.failOn = '_refresh_token.sql';

    await expect(emitAuthSql({ destDir, utc14: UTC14 })).rejects.toThrow('disk full');
    expect(await readdir(destDir)).toEqual([]);
  });

  it('the emitted set contains forward SQL only', async () => {
    const destDir = await tempDir();

    const written = await emitAuthSql({ destDir, utc14: UTC14 });

    expect(written).toHaveLength(5);
    for (const path of written) {
      expect(basename(path).startsWith(`${UTC14}_`)).toBe(true);
      expect(await readFile(path, 'utf8')).not.toMatch(/\b(drop|truncate|delete\s+from)\b/i);
    }
  });

  it('refuses a utc14 that is not 14 digits', async () => {
    const destDir = await tempDir();

    await expect(emitAuthSql({ destDir, utc14: '2026' })).rejects.toThrow(/utc14/i);
  });
});
