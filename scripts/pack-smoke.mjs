#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage } from '../tools/build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = ['config', 'logging', 'errors', 'auth-core'];
// The fixture pins the majors a consumer would install alongside the packages.
const majors = { '@nestjs/common': '^12.0.0', zod: '^4.0.0', postgres: '^3.0.0' };
const parityCheck = pathToFileURL(join(root, 'scripts/export-conditions.mjs')).href;

// A non-empty surface is the probe: an empty barrel makes this fail, which is the
// point — pack-smoke has to be red before a package exports anything.
const check = `
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { typeMismatches } from ${JSON.stringify(parityCheck)};
const load = createRequire(import.meta.url);
const names = ${JSON.stringify(packages)};
for (const name of names) {
  const esm = await import('@naulabsco/' + name);
  const cjs = load('@naulabsco/' + name);
  const fromEsm = Object.keys(esm).sort();
  const fromCjs = Object.keys(cjs).sort();
  if (fromEsm.length === 0) throw new Error(name + ': the packed barrel exports nothing');
  if (fromEsm.join(',') !== fromCjs.join(',')) {
    throw new Error(name + ': surfaces differ: ' + fromEsm + ' vs ' + fromCjs);
  }
  const mismatches = typeMismatches(esm, cjs);
  if (mismatches.length > 0) throw new Error(name + ': export types differ: ' + mismatches.join(', '));

  // Every declared dependency a consumer installs must resolve from the packed package alone.
  // A workspace: range is a monorepo alias, not something a consumer's npm can install.
  const manifestPath = load.resolve('@naulabsco/' + name + '/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dir = dirname(manifestPath);
  const declared = { ...manifest.peerDependencies, ...manifest.dependencies };
  for (const dep of Object.keys(declared)) {
    if (manifest.peerDependenciesMeta?.[dep]?.optional === true) continue;
    if (String(declared[dep]).startsWith('workspace:')) {
      throw new Error(name + ': the packed manifest still carries a workspace range for ' + dep);
    }
    load.resolve(dep, { paths: [dir] });
  }
}
console.log('pack-smoke: ' + names.length + ' packages export the same surface under import and require');
console.log('pack-smoke: every declared dependency resolves from the packed package');
`;

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

const restoreManifests = () => {
  for (const name of packages) run('node', ['scripts/publish-manifest.mjs', 'restore', `packages/${name}`], root);
};

const pack = async (name, scratch) => {
  const dir = join(root, 'packages', name);
  await buildPackage(dir);
  const { version } = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  run('npm', ['pack', '--pack-destination', scratch], dir);
  const listing = execFileSync('tar', ['-tzf', join(scratch, `naulabsco-${name}-${version}.tgz`)], { encoding: 'utf8' });
  if (listing.split('\n').some((entry) => entry.startsWith('package/src/'))) {
    throw new Error(`${name}: the packed tarball still ships src/`);
  }
  return `file:naulabsco-${name}-${version}.tgz`;
};

export async function packAndBoot() {
  // Outside the repo, so a missing dependency cannot resolve through the monorepo's node_modules.
  const scratch = await mkdtemp(join(tmpdir(), 'pack-smoke-'));
  try {
    const dependencies = { ...majors };
    for (const name of packages) dependencies[`@naulabsco/${name}`] = await pack(name, scratch);

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
