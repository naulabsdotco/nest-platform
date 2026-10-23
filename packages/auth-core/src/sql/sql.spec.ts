import { readFile } from 'node:fs/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
});
