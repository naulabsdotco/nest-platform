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

// A non-empty surface is the probe: an empty barrel makes this fail, which is the
// point — pack-smoke has to be red before a package exports anything.
const check = `
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
const names = ${JSON.stringify(packages)};
for (const name of names) {
  const esm = await import('@naulabs/' + name);
  const cjs = load('@naulabs/' + name);
  const fromEsm = Object.keys(esm).sort();
  const fromCjs = Object.keys(cjs).sort();
  if (fromEsm.length === 0) throw new Error(name + ': the packed barrel exports nothing');
  if (fromEsm.join(',') !== fromCjs.join(',')) {
    throw new Error(name + ': surfaces differ: ' + fromEsm + ' vs ' + fromCjs);
  }
  if (esm.packageName !== '@naulabs/' + name) throw new Error(name + ': wrong packageName');
}
console.log('pack-smoke: ' + names.length + ' packages export the same surface under import and require');
`;

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

const restoreManifests = () => {
  for (const name of packages) run('node', ['scripts/publish-manifest.mjs', 'restore', `packages/${name}`], root);
};

const pack = async (name) => {
  const dir = join(root, 'packages', name);
  await buildPackage(dir);
  const { version } = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  run('npm', ['pack', '--pack-destination', scratch], dir);
  const listing = execFileSync('tar', ['-tzf', join(scratch, `naulabs-${name}-${version}.tgz`)], { encoding: 'utf8' });
  if (listing.split('\n').some((entry) => entry.startsWith('package/src/'))) {
    throw new Error(`${name}: the packed tarball still ships src/`);
  }
  return `file:naulabs-${name}-${version}.tgz`;
};

export async function packAndBoot() {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    const dependencies = { ...majors };
    for (const name of packages) dependencies[`@naulabs/${name}`] = await pack(name);

    const fixture = { name: 'pack-smoke-fixture', private: true, type: 'module', dependencies };
    await writeFile(join(scratch, 'package.json'), `${JSON.stringify(fixture, null, 2)}\n`);
    await writeFile(join(scratch, 'check.mjs'), check);

    run('npm', ['install', '--no-audit', '--no-fund'], scratch);
    run('node', ['check.mjs'], scratch);
  } finally {
    restoreManifests();
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await packAndBoot();
}
