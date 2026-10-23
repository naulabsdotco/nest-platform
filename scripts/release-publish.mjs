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

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// The tarball is what npm receives; validating the source manifest would miss a pack that skipped
// the prepack strip and still carries a workspace range.
export function packedManifestIssues(manifest) {
  const issues = manifest.private === true ? ['private: true'] : [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (String(range).startsWith('workspace:')) issues.push(`${name} keeps a workspace range`);
    }
  }
  return issues;
}

const packedManifest = (tarball) =>
  JSON.parse(execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }));

export const packedTarballIssues = (tarball) => packedManifestIssues(packedManifest(tarball));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? '.release');
  const { plan } = JSON.parse(readFileSync(join(dir, 'publish-plan.json'), 'utf8'));
  const tarballs = tarballsFromPlan(plan);

  if (tarballs.length === 0) console.log('release-publish: nothing to publish');
  for (const tarball of tarballs) {
    const path = join(dir, tarball);
    const issues = packedTarballIssues(path);
    if (issues.length > 0) throw new Error(`${tarball}: ${issues.join(', ')}`);
    execFileSync('npm', publishArgs(path), { stdio: 'inherit' });
  }
}
