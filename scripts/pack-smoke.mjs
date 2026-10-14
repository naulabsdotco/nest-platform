#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage } from '../tools/build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(root, '.pack-smoke');
const packages = ['config', 'logging', 'errors', 'auth-core'];
// The fixture pins the majors a consumer would install alongside the packages.
const majors = { '@nestjs/common': '^12.0.0', zod: '^4.0.0', postgres: '^3.0.0' };

const names = JSON.stringify(packages);

const esmCheck = `
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
const names = ${names};
for (const name of names) {
  const esm = Object.keys(await import('@naulabs/' + name)).sort().join(',');
  const cjs = Object.keys(load('@naulabs/' + name)).sort().join(',');
  if (esm !== cjs) throw new Error('surface mismatch for ' + name + ': ' + esm + ' vs ' + cjs);
}
console.log('pack-smoke: import and require agree for ' + names.length + ' packages');
`;

const cjsCheck = `
const names = ${names};
(async () => {
  for (const name of names) {
    const cjs = Object.keys(require('@naulabs/' + name)).sort().join(',');
    const esm = Object.keys(await import('@naulabs/' + name)).sort().join(',');
    if (cjs !== esm) throw new Error('surface mismatch for ' + name + ': ' + cjs + ' vs ' + esm);
  }
  console.log('pack-smoke: import and require agree for ' + names.length + ' packages');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

const pack = async (name) => {
  const dir = join(root, 'packages', name);
  await buildPackage(dir);
  const { version } = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  run('npm', ['pack', '--pack-destination', scratch], dir);
  return `file:naulabs-${name}-${version}.tgz`;
};

export async function packAndBoot() {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });

  const dependencies = { ...majors };
  for (const name of packages) dependencies[`@naulabs/${name}`] = await pack(name);

  const fixture = { name: 'pack-smoke-fixture', private: true, type: 'module', dependencies };
  await writeFile(join(scratch, 'package.json'), `${JSON.stringify(fixture, null, 2)}\n`);
  await writeFile(join(scratch, 'check.mjs'), esmCheck);
  await writeFile(join(scratch, 'check.cjs'), cjsCheck);

  run('npm', ['install', '--no-audit', '--no-fund'], scratch);
  run('node', ['check.mjs'], scratch);
  run('node', ['check.cjs'], scratch);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await packAndBoot();
}
