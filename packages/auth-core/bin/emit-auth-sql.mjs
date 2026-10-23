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
  const written = [];
  try {
    for (const { source, target } of targets) {
      // `wx` is the second line of defence: the pre-check above is not atomic on its own.
      await writeFile(target, await readFile(source), { flag: 'wx' });
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

  if (destDir === undefined || utc14 === undefined) {
    console.error('usage: emit-auth-sql --dest <dir> --utc14 <14-digit utc timestamp>');
    process.exitCode = 2;
    return;
  }
  for (const written of await emitAuthSql({ destDir, utc14 })) console.log(written);
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
