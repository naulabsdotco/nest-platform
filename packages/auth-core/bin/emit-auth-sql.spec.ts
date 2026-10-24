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

  it('renaming one table renames it inside a compound index name too', async () => {
    const destDir = await tempDir();

    await emitAuthSql({ destDir, utc14: UTC14, tables: { subject: 'accounts' } });

    const refresh = await readFile(join(destDir, `${UTC14}_refresh_token.sql`), 'utf8');
    expect(refresh).toContain('refresh_token_live_accounts_idx');
    expect(refresh).not.toContain('refresh_token_live_subject_idx');
  });

  it('refuses an unknown credential column option or a non-boolean value', async () => {
    const destDir = await tempDir();
    const invalid = [
      { credential: { failedcount: false } },
      { credential: { failedCount: 'false' } },
      { credentialx: {} },
    ];

    for (const columns of invalid) {
      await expect(
        emitAuthSql({ destDir, utc14: UTC14, columns } as unknown as Parameters<typeof emitAuthSql>[0]),
      ).rejects.toThrow(/columns/);
    }
  });

  it('refuses a rename whose derived identifier would exceed the 63-byte limit', async () => {
    const destDir = await tempDir();

    await expect(
      emitAuthSql({ destDir, utc14: UTC14, tables: { loginAttempt: 'a'.repeat(50) } }),
    ).rejects.toThrow(/63/);
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
    expect(sessions).toContain('CREATE INDEX sessions_live_accounts_idx ON sessions (accounts_id)');
    expect(resets).toContain('resets_live_accounts_idx ON resets (accounts_id)');
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

describe('emitAuthSql check mode', () => {
  it('reports every file in sync after a write and never writes in check mode', async () => {
    const destDir = await tempDir();
    await emitAuthSql({ destDir, utc14: UTC14 });
    const before = await readdir(destDir);

    const report = await emitAuthSql({ destDir, utc14: UTC14, mode: 'check' });

    expect(report).toHaveLength(5);
    expect(report.every((entry) => entry.status === 'in-sync')).toBe(true);
    expect(await readdir(destDir)).toEqual(before);
  });

  it('reports a modified file as differs and leaves it untouched', async () => {
    const destDir = await tempDir();
    await emitAuthSql({ destDir, utc14: UTC14 });
    const target = join(destDir, `${UTC14}_subject.sql`);
    await writeFile(target, '-- edited\n');

    const report = await emitAuthSql({ destDir, utc14: UTC14, mode: 'check' });

    expect(report.find((entry) => entry.path === target)?.status).toBe('differs');
    expect(report.filter((entry) => entry.status === 'in-sync')).toHaveLength(4);
    expect(await readFile(target, 'utf8')).toBe('-- edited\n');
  });

  it('reports a missing file and does not create the directory', async () => {
    const destDir = join(await tempDir(), 'not-created');

    const report = await emitAuthSql({ destDir, utc14: UTC14, mode: 'check' });

    expect(report.map((entry) => entry.status)).toEqual(Array(5).fill('missing'));
    await expect(readdir(destDir)).rejects.toThrow();
  });
});

describe('emitAuthSql down and verify', () => {
  it('emits one down file per table, dropping in reverse foreign-key order', async () => {
    const destDir = await tempDir();

    const written = await emitAuthSql({ destDir, utc14: UTC14, direction: 'down' });

    expect(written.map((path) => basename(path))).toEqual([
      `${UTC14}_login_attempt.down.sql`,
      `${UTC14}_password_reset_token.down.sql`,
      `${UTC14}_refresh_token.down.sql`,
      `${UTC14}_subject_credential.down.sql`,
      `${UTC14}_subject.down.sql`,
    ]);
    for (const path of written) expect(await readFile(path, 'utf8')).toMatch(/^DROP TABLE IF EXISTS /);
  });

  it('down follows the table map', async () => {
    const destDir = await tempDir();

    await emitAuthSql({ destDir, utc14: UTC14, direction: 'down', tables: { subject: 'accounts' } });

    expect(await readFile(join(destDir, `${UTC14}_subject.down.sql`), 'utf8')).toContain('accounts');
  });

  it('direction both emits the up set and the down set', async () => {
    const destDir = await tempDir();

    const written = await emitAuthSql({ destDir, utc14: UTC14, direction: 'both' });

    expect(written).toHaveLength(10);
    expect(written.filter((path) => path.endsWith('.down.sql'))).toHaveLength(5);
    expect(await readdir(destDir)).toHaveLength(10);
  });

  it('verify emits schema assertions that name the emitted tables', async () => {
    const destDir = await tempDir();

    const written = await emitAuthSql({
      destDir,
      utc14: UTC14,
      verify: true,
      tables: { subject: 'accounts' },
    });

    const verify = written.find((path) => basename(path) === `${UTC14}_verify.sql`);
    expect(verify).toBeDefined();
    const sql = await readFile(verify as string, 'utf8');
    expect(sql).toMatch(/to_regclass\(quote_ident\(current_schema\(\)\) \|\| '\.accounts'\)/);
    expect(sql).toMatch(/to_regclass\(quote_ident\(current_schema\(\)\) \|\| '\.subject_credential'\)/);
    expect(sql).toMatch(/table_schema = current_schema\(\)/);
  });

  it('emits verify before the down set, so the returned order is safe to apply as-is', async () => {
    const destDir = await tempDir();

    const written = await emitAuthSql({ destDir, utc14: UTC14, direction: 'both', verify: true });

    expect(written).toHaveLength(11);
    expect(written.findIndex((path) => path.endsWith('_verify.sql'))).toBeLessThan(
      written.findIndex((path) => path.endsWith('.down.sql')),
    );
  });

  it('refuses verify with a down-only emission', async () => {
    const destDir = await tempDir();

    await expect(emitAuthSql({ destDir, utc14: UTC14, direction: 'down', verify: true })).rejects.toThrow(/verify/i);
  });

  it('write mode still refuses to overwrite an emitted down file', async () => {
    const destDir = await tempDir();
    await emitAuthSql({ destDir, utc14: UTC14, direction: 'down' });

    await expect(emitAuthSql({ destDir, utc14: UTC14, direction: 'down' })).rejects.toThrow(/overwrite/i);
  });
});

describe('emit-auth-sql --check', () => {
  const bin = fileURLToPath(new URL('./emit-auth-sql.mjs', import.meta.url));

  it('exits 0 and prints in-sync when the directory matches', async () => {
    const destDir = await tempDir();
    await emitAuthSql({ destDir, utc14: UTC14 });

    const { stdout } = await run(process.execPath, [bin, '--dest', destDir, '--utc14', UTC14, '--check']);

    expect(stdout).toContain(`in-sync ${join(destDir, `${UTC14}_subject.sql`)}`);
  });

  it('exits 1, prints differs and writes nothing when a file changed', async () => {
    const destDir = await tempDir();
    await emitAuthSql({ destDir, utc14: UTC14 });
    const target = join(destDir, `${UTC14}_subject.sql`);
    await writeFile(target, '-- edited\n');

    const failure = await run(process.execPath, [bin, '--dest', destDir, '--utc14', UTC14, '--check']).catch(
      (error: { code?: number; stdout?: string }) => error,
    );

    expect(failure).toMatchObject({ code: 1 });
    expect((failure as { stdout?: string }).stdout).toContain(`differs ${target}`);
    expect(await readFile(target, 'utf8')).toBe('-- edited\n');
  });

  it('prints missing for a directory that does not exist', async () => {
    const destDir = join(await tempDir(), 'absent');

    const failure = await run(process.execPath, [bin, '--dest', destDir, '--utc14', UTC14, '--check']).catch(
      (error: { code?: number; stdout?: string }) => error,
    );

    expect((failure as { stdout?: string }).stdout).toContain(`missing ${join(destDir, `${UTC14}_subject.sql`)}`);
  });

  it('takes direction and verify from the config file when no flag overrides them', async () => {
    const destDir = await tempDir();
    const configPath = join(await tempDir(), 'emit-config.json');
    await writeFile(configPath, JSON.stringify({ direction: 'both', verify: true }));

    const { stdout } = await run(process.execPath, [bin, '--dest', destDir, '--utc14', UTC14, '--config', configPath]);

    expect(stdout).toContain(`${UTC14}_subject.down.sql`);
    expect(stdout).toContain(`${UTC14}_verify.sql`);
    expect(await readdir(destDir)).toHaveLength(11);
  });

  it('lets an explicit CLI direction override the config file', async () => {
    const destDir = await tempDir();
    const configPath = join(await tempDir(), 'emit-config.json');
    await writeFile(configPath, JSON.stringify({ direction: 'both' }));

    await run(process.execPath, [bin, '--dest', destDir, '--utc14', UTC14, '--config', configPath, '--direction', 'up']);

    expect((await readdir(destDir)).sort()).toEqual([
      `${UTC14}_login_attempt.sql`,
      `${UTC14}_password_reset_token.sql`,
      `${UTC14}_refresh_token.sql`,
      `${UTC14}_subject.sql`,
      `${UTC14}_subject_credential.sql`,
    ]);
  });
});
