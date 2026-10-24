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

  it('emit-auth-sql output has no rollback or verification files', async () => {
    const destDir = await tempDir();

    const written = await emitAuthSql({ destDir, utc14: UTC14 });

    expect(written).toHaveLength(5);
    for (const path of written) {
      expect(basename(path)).not.toMatch(/rollback|verification|verify|down/i);
    }
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

describe('emitAuthSql options', () => {
  it('renamed tables apply to the CREATE TABLE and the foreign key', async () => {
    const destDir = await tempDir();

    await emitAuthSql({ destDir, utc14: UTC14, tables: { subject: 'accounts', credential: 'user_credentials' } });

    const subject = await readFile(join(destDir, `${UTC14}_subject.sql`), 'utf8');
    const credential = await readFile(join(destDir, `${UTC14}_subject_credential.sql`), 'utf8');
    expect(subject).toContain('CREATE TABLE accounts (');
    expect(credential).toContain('CREATE TABLE user_credentials (');
    expect(credential).toContain('accounts_id uuid PRIMARY KEY REFERENCES accounts (id)');
    expect(credential).not.toMatch(/\bsubject(_credential)?\b/);
  });

  it('renaming only the subject table leaves the credential table name alone', async () => {
    const destDir = await tempDir();

    await emitAuthSql({ destDir, utc14: UTC14, tables: { subject: 'accounts' } });

    const credential = await readFile(join(destDir, `${UTC14}_subject_credential.sql`), 'utf8');
    expect(credential).toContain('CREATE TABLE subject_credential (');
    expect(credential).toContain('accounts_id uuid PRIMARY KEY REFERENCES accounts (id)');
  });

  it('refuses two tables mapped to the same name', async () => {
    const destDir = await tempDir();

    await expect(
      emitAuthSql({ destDir, utc14: UTC14, tables: { subject: 'accounts', credential: 'accounts' } }),
    ).rejects.toThrow(/distinct/i);
  });

  it('every foreign key and index name follows the table map', async () => {
    const destDir = await tempDir();
    const tables = {
      subject: 'accounts',
      credential: 'user_credentials',
      refreshToken: 'sessions',
      resetToken: 'resets',
      loginAttempt: 'attempts',
    };

    await emitAuthSql({ destDir, utc14: UTC14, tables });

    const read = (name: string): Promise<string> => readFile(join(destDir, `${UTC14}_${name}.sql`), 'utf8');
    const sessions = await read('refresh_token');
    const resets = await read('password_reset_token');
    const attempts = await read('login_attempt');
    expect(sessions).toContain('accounts_id uuid NOT NULL REFERENCES accounts (id)');
    expect(sessions).toContain('CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash)');
    expect(sessions).toContain('CREATE INDEX sessions_live_subject_idx ON sessions (accounts_id)');
    expect(resets).toContain('resets_live_subject_idx ON resets (accounts_id)');
    expect(attempts).toContain('CREATE INDEX attempts_email_hash_at_idx ON attempts (email_hash, at)');
    for (const sql of [sessions, resets, attempts]) {
      expect(sql).not.toMatch(/\b(subject|subject_credential|refresh_token|password_reset_token|login_attempt)\b/);
    }
  });

  it('disabled credential columns are absent and the remaining columns stay comma-separated', async () => {
    const destDir = await tempDir();

    await emitAuthSql({
      destDir,
      utc14: UTC14,
      columns: { credential: { sourceUpdatedAt: false, failedCount: false, lockedUntil: false } },
    });

    const credential = await readFile(join(destDir, `${UTC14}_subject_credential.sql`), 'utf8');
    expect(credential).not.toMatch(/source_updated_at|failed_count|locked_until/);
    expect(credential).toContain('hash text NOT NULL');
    expect(credential).not.toMatch(/,\s*\n\);/);
  });

  it('an omitted option keeps every emitted file byte-identical to the reference', async () => {
    const destDir = await tempDir();

    await emitAuthSql({ destDir, utc14: UTC14 });

    for (const name of [
      '0001_subject.sql',
      '0002_subject_credential.sql',
      '0003_refresh_token.sql',
      '0004_password_reset_token.sql',
      '0005_login_attempt.sql',
    ]) {
      const emitted = await readFile(join(destDir, `${UTC14}_${name.replace(/^\d{4}_/, '')}`), 'utf8');
      expect(emitted).toBe(await sourceOf(name));
    }
  });

  it('a partitioned login attempt declares the range on the requested column', async () => {
    const destDir = await tempDir();

    await emitAuthSql({ destDir, utc14: UTC14, loginAttempt: { partitioned: { by: 'range', column: 'at' } } });

    const attempts = await readFile(join(destDir, `${UTC14}_login_attempt.sql`), 'utf8');
    expect(attempts).toContain(') PARTITION BY RANGE (at);');
  });

  it('refuses a table name that could break out of the identifier', async () => {
    const destDir = await tempDir();

    await expect(
      emitAuthSql({ destDir, utc14: UTC14, tables: { subject: 'accounts; drop table subject' } }),
    ).rejects.toThrow(/tables\.subject/);
  });

  it('refuses a partition on a column the table does not have', async () => {
    const destDir = await tempDir();

    await expect(
      emitAuthSql({ destDir, utc14: UTC14, loginAttempt: { partitioned: { by: 'range', column: 'missing' } } }),
    ).rejects.toThrow(/missing/);
  });
});
