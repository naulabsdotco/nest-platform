import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitAuthSql } from '../../bin/emit-auth-sql.mjs';

const SQL = new URL('../../sql/', import.meta.url);

const FILES = [
  '0001_subject.sql',
  '0002_subject_credential.sql',
  '0003_refresh_token.sql',
  '0004_password_reset_token.sql',
  '0005_login_attempt.sql',
] as const;

const read = (file: string): Promise<string> => readFile(new URL(file, SQL), 'utf8');

const wholeSchema = async (): Promise<string> => (await Promise.all(FILES.map(read))).join('\n');

describe('reference SQL', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17').start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  }, 240_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('the five reference files apply cleanly to postgres:17', async () => {
    for (const file of FILES) await client.query(await read(file));

    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'login_attempt',
      'password_reset_token',
      'refresh_token',
      'subject',
      'subject_credential',
    ]);
  }, 60_000);

  it('no plaintext credential or token column exists', async () => {
    const schema = await wholeSchema();

    expect(schema).not.toMatch(/\b(password|secret)\s+(text|varchar|bytea)\b/i);
    expect(schema).not.toMatch(/\btoken\s+(text|varchar|bytea)\b/i);
    expect(schema).toMatch(/token_hash\s+text\s+not\s+null/i);
    expect(schema).toMatch(/\bhash\s+text\s+not\s+null/i);
  });

  it('re-applying emits no destructive statement', async () => {
    expect(await wholeSchema()).not.toMatch(/\b(drop|truncate|delete\s+from)\b/i);
  });

  it('a renamed emit with optional columns disabled applies cleanly', async () => {
    const destDir = await mkdtemp(join(tmpdir(), 'auth-core-sql-'));
    try {
      const written = await emitAuthSql({
        destDir,
        utc14: '20260101000000',
        tables: {
          subject: 'accounts',
          credential: 'user_credentials',
          refreshToken: 'sessions',
          resetToken: 'resets',
          loginAttempt: 'attempts',
        },
        columns: { credential: { sourceUpdatedAt: false, failedCount: false, lockedUntil: false } },
        loginAttempt: { partitioned: { by: 'range', column: 'at' } },
      });
      for (const file of written) await client.query(await readFile(file, 'utf8'));

      const { rows } = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('accounts','user_credentials','sessions','resets','attempts') order by table_name",
      );
      expect(rows.map((row) => row.table_name)).toEqual([
        'accounts',
        'attempts',
        'resets',
        'sessions',
        'user_credentials',
      ]);
      const { rows: columns } = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'user_credentials' order by column_name",
      );
      expect(columns.map((column) => column.column_name)).toEqual(['accounts_id', 'algo', 'hash']);
      const { rows: partitioned } = await client.query<{ partitioned: boolean }>(
        "select relkind = 'p' as partitioned from pg_class where relname = 'attempts'",
      );
      expect(partitioned[0]?.partitioned).toBe(true);
      expect((await readdir(destDir)).sort()).toEqual([
        '20260101000000_login_attempt.sql',
        '20260101000000_password_reset_token.sql',
        '20260101000000_refresh_token.sql',
        '20260101000000_subject.sql',
        '20260101000000_subject_credential.sql',
      ]);
    } finally {
      await rm(destDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('the down and verify files apply after up', async () => {
    const destDir = await mkdtemp(join(tmpdir(), 'auth-core-sql-'));
    try {
      const written = await emitAuthSql({
        destDir,
        utc14: '20260101000100',
        direction: 'both',
        verify: true,
        tables: {
          subject: 'members',
          credential: 'member_credentials',
          refreshToken: 'member_sessions',
          resetToken: 'member_resets',
          loginAttempt: 'member_attempts',
        },
        columns: { credential: { lockedUntil: false } },
      });
      const ups = written.filter((path) => !path.endsWith('.down.sql') && !path.endsWith('_verify.sql'));
      const verify = written.filter((path) => path.endsWith('_verify.sql'));

      // Apply the returned order as a consumer would: up, then verify, then down.
      for (const file of written) await client.query(await readFile(file, 'utf8'));

      expect(ups).toHaveLength(5);
      expect(verify).toHaveLength(1);

      const { rows } = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'member%'",
      );
      expect(rows).toEqual([]);

      // The same assertions fail loudly once the schema is gone; the verify file is not a no-op.
      await expect(client.query(await readFile(verify[0] as string, 'utf8'))).rejects.toThrow(/verify: table/);
    } finally {
      await rm(destDir, { recursive: true, force: true });
    }
  }, 60_000);
});
