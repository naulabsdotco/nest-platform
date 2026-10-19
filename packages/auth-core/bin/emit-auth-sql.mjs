#!/usr/bin/env node
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The CJS build has __filename; the ESM source and build have import.meta.url. Neither is read in
// the other's format, so the same file serves the bin, dist/esm and dist/cjs.
const here = typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url);
// Resolved through the package root: the bundled copy in dist/ must still find the shipped sql/.
const SQL_DIR = join(dirname(createRequire(here).resolve('@naulabs/auth-core/package.json')), 'sql');
const UTC14 = /^\d{14}$/;
// The package's ordinal orders its own files; a consumer orders by the utc14 prefix it passes in.
const ORDINAL = /^\d{4}_/;

const exists = (path) => access(path).then(() => true, () => false);

/**
 * Copies the reference SQL into a consumer's migration directory as `<utc14>_<name>.sql`.
 * The files are never executed here and an existing target is never overwritten.
 */
export async function emitAuthSql({ destDir, utc14 }) {
  if (!UTC14.test(utc14)) throw new Error(`utc14 must be 14 digits, got ${JSON.stringify(utc14)}`);

  const sources = (await readdir(SQL_DIR)).filter((name) => name.endsWith('.sql')).sort();
  const targets = sources.map((source) => ({
    source: join(SQL_DIR, source),
    target: join(destDir, `${utc14}_${source.replace(ORDINAL, '')}`),
  }));

  for (const { target } of targets) {
    if (await exists(target)) throw new Error(`refusing to overwrite ${target}`);
  }

  await mkdir(destDir, { recursive: true });
  for (const { source, target } of targets) {
    // `wx` is the second line of defence: the pre-check above is not atomic on its own.
    await writeFile(target, await readFile(source), { flag: 'wx' });
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

  if (destDir === undefined || utc14 === undefined) {
    console.error('usage: emit-auth-sql --dest <dir> --utc14 <14-digit utc timestamp>');
    process.exitCode = 2;
    return;
  }
  for (const written of await emitAuthSql({ destDir, utc14 })) console.log(written);
}

if (process.argv[1] === here) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
