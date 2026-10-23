#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const publishArgs = (tarball) => [
  'publish',
  tarball,
  '--provenance',
  '--access',
  'public',
  '--tag',
  'latest',
];

export function tarballsFromPlan(plan) {
  return plan
    .flat()
    .filter((release) => release.kind === 'publish')
    .map((release) => release.tarball.path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? '.release');
  const { plan } = JSON.parse(readFileSync(join(dir, 'publish-plan.json'), 'utf8'));
  const tarballs = tarballsFromPlan(plan);

  if (tarballs.length === 0) console.log('release-publish: nothing to publish');
  for (const tarball of tarballs) {
    execFileSync('npm', publishArgs(join(dir, tarball)), { stdio: 'inherit' });
  }
}
