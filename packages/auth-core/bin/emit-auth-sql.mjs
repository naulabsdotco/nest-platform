#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The CJS build has __filename; the ESM source and build have import.meta.url. Neither is read in
// the other's format, so the same file serves the bin, dist/esm and dist/cjs.
const here = typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url);
// Resolved through the package root: the bundled copy in dist/ must still find the shipped sql/.
const SQL_DIR = join(dirname(createRequire(here).resolve('@naulabsco/auth-core/package.json')), 'sql');
const UTC14 = /^\d{14}$/;
// The package's ordinal orders its own files; a consumer orders by the utc14 prefix it passes in.
const ORDINAL = /^\d{4}_/;
// Option values are interpolated into emitted SQL, so only a plain identifier is accepted.
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

const TABLES = {
  subject: 'subject',
  credential: 'subject_credential',
  refreshToken: 'refresh_token',
  resetToken: 'password_reset_token',
  loginAttempt: 'login_attempt',
};

const CREDENTIAL_COLUMNS = {
  sourceUpdatedAt: 'source_updated_at',
  failedCount: 'failed_count',
  lockedUntil: 'locked_until',
};

// Each reference file owns one table; a rename is applied to every file because the other files
// reference it (the foreign key and the index names carry the table name).
const FILE_TABLE = {
  '0001_subject.sql': 'subject',
  '0002_subject_credential.sql': 'credential',
  '0003_refresh_token.sql': 'refreshToken',
  '0004_password_reset_token.sql': 'resetToken',
  '0005_login_attempt.sql': 'loginAttempt',
};

const exists = (path) => access(path).then(() => true, () => false);

const identifier = (value, option) => {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`${option} must be a lowercase SQL identifier, got ${JSON.stringify(value)}`);
  }
  return value;
};

const renameMap = (tables = {}) => {
  const map = new Map(
    Object.entries(tables).map(([key, name]) => {
      if (TABLES[key] === undefined) throw new Error(`unknown tables option ${JSON.stringify(key)}`);
      return [key, name];
    }),
  );
  const names = Object.fromEntries(
    Object.entries(TABLES).map(([key, fallback]) => [
      fallback,
      map.has(key) ? identifier(map.get(key), `tables.${key}`) : fallback,
    ]),
  );
  const final = Object.values(names);
  if (new Set(final).size !== final.length) throw new Error('tables must map to distinct names');
  return new Map(Object.entries(names));
};

// Longest key first so `subject_credential` wins over `subject`. A renamed table also renames the
// columns and indexes that carry it as a prefix (`subject_id`, `subject_credential_pkey`).
const renameIdentifiers = (sql, renames) => {
  const keys = [...renames.keys()].sort((a, b) => b.length - a.length);
  if (keys.length === 0) return sql;
  return sql.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    const key = keys.find((candidate) => token === candidate || token.startsWith(`${candidate}_`));
    return key === undefined ? token : `${renames.get(key)}${token.slice(key.length)}`;
  });
};

const editTable = (sql, table, edit) =>
  sql.replace(new RegExp(`(CREATE TABLE ${table} \\()([\\s\\S]*?)(\\n\\);)`), (_match, head, body, tail) =>
    edit(head, body, tail),
  );

const dropColumns = (sql, table, columns) =>
  editTable(sql, table, (head, body, tail) => {
    const kept = body
      .split('\n')
      .filter((line) => line.trim() !== '' && !columns.some((column) => new RegExp(`^\\s*${column}\\s`).test(line)))
      .map((line, index, lines) => `${line.trimEnd().replace(/,$/, '')}${index === lines.length - 1 ? '' : ','}`);
    return `${head}\n${kept.join('\n')}${tail}`;
  });

const partition = (sql, table, { by, column }) => {
  if (by !== 'range') throw new Error(`partitioned.by must be "range", got ${JSON.stringify(by)}`);
  identifier(column, 'loginAttempt.partitioned.column');
  return editTable(sql, table, (head, body) => {
    if (!new RegExp(`^\\s*${column}\\s`, 'm').test(body)) {
      throw new Error(`loginAttempt.partitioned.column ${JSON.stringify(column)} is not a column of ${table}`);
    }
    return `${head}${body}\n) PARTITION BY RANGE (${column});`;
  });
};

const transform = (source, sql, { tables, columns, loginAttempt }) => {
  const table = FILE_TABLE[source];
  let out = sql;
  if (table === 'credential' && columns?.credential !== undefined) {
    const disabled = Object.entries(CREDENTIAL_COLUMNS)
      .filter(([key]) => columns.credential[key] === false)
      .map(([, name]) => name);
    if (disabled.length > 0) out = dropColumns(out, TABLES.credential, disabled);
  }
  if (table === 'loginAttempt' && loginAttempt?.partitioned !== undefined) {
    out = partition(out, TABLES.loginAttempt, loginAttempt.partitioned);
  }
  return renameIdentifiers(out, renameMap(tables));
};

/**
 * Copies the reference SQL into a consumer's migration directory as `<utc14>_<name>.sql`.
 * The files are never executed here and an existing target is never overwritten. Omitted options
 * keep the reference names and shape, so the emitted bytes are the source files.
 */
export async function emitAuthSql({ destDir, utc14, tables, columns, loginAttempt }) {
  if (!UTC14.test(utc14)) throw new Error(`utc14 must be 14 digits, got ${JSON.stringify(utc14)}`);

  const sources = (await readdir(SQL_DIR)).filter((name) => name.endsWith('.sql')).sort();
  const targets = await Promise.all(
    sources.map(async (source) => ({
      source,
      target: join(destDir, `${utc14}_${source.replace(ORDINAL, '')}`),
      contents: transform(source, await readFile(join(SQL_DIR, source), 'utf8'), { tables, columns, loginAttempt }),
    })),
  );

  for (const { target } of targets) {
    if (await exists(target)) throw new Error(`refusing to overwrite ${target}`);
  }

  await mkdir(destDir, { recursive: true });
  const written = [];
  try {
    for (const { target, contents } of targets) {
      // `wx` is the second line of defence: the pre-check above is not atomic on its own.
      await writeFile(target, contents, { flag: 'wx' });
      written.push(target);
    }
  } catch (error) {
    // A half-written set would be blocked from retry by the overwrite guard; remove only this run's files.
    await Promise.all(written.map((path) => rm(path, { force: true })));
    throw error;
  }
  return targets.map(({ target }) => target);
}

async function run() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const destDir = valueOf('--dest');
  const utc14 = valueOf('--utc14');
  const configPath = valueOf('--config');

  if (destDir === undefined || utc14 === undefined) {
    console.error('usage: emit-auth-sql --dest <dir> --utc14 <14-digit utc timestamp> [--config <json>]');
    process.exitCode = 2;
    return;
  }
  const config = configPath === undefined ? {} : JSON.parse(await readFile(configPath, 'utf8'));
  for (const written of await emitAuthSql({ destDir, utc14, ...config })) console.log(written);
}

// A consumer invokes this through node_modules/.bin, which is a symlink: argv[1] is the link while
// import.meta.url is the real file, so the two must be compared after realpath.
const isMain = () => {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === realpathSync(here);
  } catch {
    return false;
  }
};

if (isMain()) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
