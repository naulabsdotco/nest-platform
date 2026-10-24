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

const MAX_IDENTIFIER = 63;

const validateColumns = (columns) => {
  if (columns === undefined) return;
  for (const key of Object.keys(columns)) {
    if (key !== 'credential') throw new Error(`unknown columns option ${JSON.stringify(key)}`);
  }
  if (columns.credential === undefined) return;
  for (const [key, value] of Object.entries(columns.credential)) {
    if (CREDENTIAL_COLUMNS[key] === undefined) {
      throw new Error(`unknown columns.credential option ${JSON.stringify(key)}`);
    }
    if (typeof value !== 'boolean') throw new Error(`columns.credential.${key} must be a boolean`);
  }
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

// A table name is replaced wherever it appears as a whole underscore segment, so an index that
// embeds it (`refresh_token_live_subject_idx`) follows the map as well as a prefix (`subject_id`).
// Identities are present for every unrenamed table, so `subject_credential` is matched whole and its
// `subject` is not rewritten by a rename of `subject` alone.
const renameIdentifiers = (sql, renames) => {
  const keys = [...renames.keys()].sort((a, b) => b.length - a.length);
  return sql.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    let renamed = '';
    let index = 0;
    while (index < token.length) {
      const atBoundary = index === 0 || token[index - 1] === '_';
      const key = atBoundary
        ? keys.find(
            (candidate) =>
              token.startsWith(candidate, index) &&
              (index + candidate.length === token.length || token[index + candidate.length] === '_'),
          )
        : undefined;
      if (key === undefined) {
        renamed += token[index];
        index += 1;
        continue;
      }
      renamed += renames.get(key);
      index += key.length;
    }
    if (renamed.length > MAX_IDENTIFIER) {
      throw new Error(`renamed identifier ${JSON.stringify(renamed)} exceeds ${MAX_IDENTIFIER} bytes`);
    }
    return renamed;
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
  validateColumns(columns);
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

const DOWN_ORDER = ['loginAttempt', 'resetToken', 'refreshToken', 'credential', 'subject'];

const tableNames = (renames) =>
  Object.fromEntries(Object.entries(TABLES).map(([key, name]) => [key, renames.get(name) ?? name]));

const upFiles = async (shape) => {
  const sources = (await readdir(SQL_DIR)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    sources.map(async (source) => ({
      name: source.replace(ORDINAL, ''),
      table: FILE_TABLE[source],
      contents: transform(source, await readFile(join(SQL_DIR, source), 'utf8'), shape),
    })),
  );
};

const existsStatement = (table, column) =>
  `  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${column}') THEN
    RAISE EXCEPTION 'verify: ${table}.${column} is missing';
  END IF;`;

// Plain SQL, not pgTap: the consumer's migration gate runs it against the applied schema. Both the
// table and column checks resolve against `current_schema()`, so a non-default search_path agrees
// with itself.
const verifySql = (names, dropped, partitioned) => {
  const statements = DOWN_ORDER.map(
    (key) => `  IF to_regclass(quote_ident(current_schema()) || '.${names[key]}') IS NULL THEN
    RAISE EXCEPTION 'verify: table ${names[key]} is missing';
  END IF;`,
  );
  statements.push(existsStatement(names.credential, 'hash'));
  statements.push(existsStatement(names.refreshToken, 'token_hash'));
  statements.push(existsStatement(names.resetToken, 'token_hash'));
  for (const column of dropped) {
    statements.push(`  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = '${names.credential}' AND column_name = '${column}') THEN
    RAISE EXCEPTION 'verify: ${names.credential}.${column} should be absent';
  END IF;`);
  }
  if (partitioned) {
    statements.push(`  IF NOT EXISTS (SELECT 1 FROM pg_partitioned_table
    JOIN pg_class ON pg_class.oid = pg_partitioned_table.partrelid
    WHERE relname = '${names.loginAttempt}' AND relnamespace = current_schema()::regnamespace) THEN
    RAISE EXCEPTION 'verify: ${names.loginAttempt} is not partitioned';
  END IF;`);
  }
  return `DO $$\nBEGIN\n${statements.join('\n')}\nEND\n$$;\n`;
};

const plan = async ({ destDir, utc14, direction = 'up', verify = false, ...shape }) => {
  if (!UTC14.test(utc14)) throw new Error(`utc14 must be 14 digits, got ${JSON.stringify(utc14)}`);
  if (!['up', 'down', 'both'].includes(direction)) {
    throw new Error(`direction must be "up", "down" or "both", got ${JSON.stringify(direction)}`);
  }
  if (verify && direction === 'down') throw new Error('verify requires direction "up" or "both"');

  const renames = renameMap(shape.tables);
  const names = tableNames(renames);
  const ups = await upFiles(shape);
  const files = [];
  if (direction !== 'down') files.push(...ups);
  if (verify) {
    const dropped = Object.entries(CREDENTIAL_COLUMNS)
      .filter(([key]) => shape.columns?.credential?.[key] === false)
      .map(([, column]) => column);
    files.push({
      name: 'verify.sql',
      contents: verifySql(names, dropped, shape.loginAttempt?.partitioned !== undefined),
    });
  }
  if (direction !== 'up') {
    files.push(
      ...[...ups].reverse().map(({ name, table }) => ({
        name: `${name.replace(/\.sql$/, '')}.down.sql`,
        contents: `DROP TABLE IF EXISTS ${names[table]};\n`,
      })),
    );
  }
  return files.map(({ name, contents }) => ({ target: join(destDir, `${utc14}_${name}`), contents }));
};

/**
 * Copies the reference SQL into a consumer's migration directory as `<utc14>_<name>.sql`.
 * The files are never executed here and an existing target is never overwritten. Omitted options
 * keep the reference names and shape, so the emitted bytes are the source files. Check mode writes
 * nothing and reports each planned file as `missing`, `differs` or `in-sync`.
 */
export async function emitAuthSql(opts) {
  const planned = await plan(opts);

  if (opts.mode === 'check') {
    return Promise.all(
      planned.map(async ({ target, contents }) => ({
        path: target,
        status: !(await exists(target))
          ? 'missing'
          : (await readFile(target, 'utf8')) === contents
            ? 'in-sync'
            : 'differs',
      })),
    );
  }
  if (opts.mode !== undefined && opts.mode !== 'write') {
    throw new Error(`mode must be "write" or "check", got ${JSON.stringify(opts.mode)}`);
  }

  for (const { target } of planned) {
    if (await exists(target)) throw new Error(`refusing to overwrite ${target}`);
  }

  await mkdir(opts.destDir, { recursive: true });
  const written = [];
  try {
    for (const { target, contents } of planned) {
      // `wx` is the second line of defence: the pre-check above is not atomic on its own.
      await writeFile(target, contents, { flag: 'wx' });
      written.push(target);
    }
  } catch (error) {
    // A half-written set would be blocked from retry by the overwrite guard; remove only this run's files.
    await Promise.all(written.map((path) => rm(path, { force: true })));
    throw error;
  }
  return planned.map(({ target }) => target);
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
    console.error(
      'usage: emit-auth-sql --dest <dir> --utc14 <14-digit utc timestamp> [--config <json>] [--check] [--direction up|down|both] [--verify]',
    );
    process.exitCode = 2;
    return;
  }
  const config = configPath === undefined ? {} : JSON.parse(await readFile(configPath, 'utf8'));
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('--config must contain a JSON object');
  }

  // An explicit flag wins; otherwise the config file supplies the mode, direction and verify flag.
  const mode = args.includes('--check') ? 'check' : (config.mode ?? 'write');
  const direction = valueOf('--direction') ?? config.direction;
  const verify = args.includes('--verify') ? true : (config.verify ?? false);
  if (verify !== true && verify !== false) throw new Error('verify must be a boolean');

  const emission = await emitAuthSql({ ...config, destDir, utc14, mode, direction, verify });

  if (mode === 'check') {
    for (const { path, status } of emission) console.log(`${status} ${path}`);
    if (emission.some(({ status }) => status !== 'in-sync')) process.exitCode = 1;
    return;
  }
  for (const written of emission) console.log(written);
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
