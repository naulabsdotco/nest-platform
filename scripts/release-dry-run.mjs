#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishManifest } from './publish-manifest.mjs';

export const WORKSPACE_PACKAGES = ['config', 'logging', 'errors', 'auth-core'];
export const PUBLISHED_PACKAGES = ['config', 'logging', 'errors'];
export const ARTIFACTS = ['dist/esm/index.js', 'dist/cjs/index.js', 'dist/esm/index.d.ts', 'dist/cjs/index.d.cts'];
const LOCKFILE = /^(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock)$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export function missingArtifacts(dir, exists = existsSync) {
  return ARTIFACTS.filter((file) => !exists(join(dir, file)));
}

export function pendingPackages(changesetDir) {
  if (!existsSync(changesetDir)) return new Set();
  const names = readdirSync(changesetDir)
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) =>
      [...readFileSync(join(changesetDir, file), 'utf8').matchAll(/^"(@naulabs\/[\w-]+)":/gm)].map(
        (match) => match[1],
      ),
    );
  return new Set(names);
}

export function tarballIssues(files) {
  return files.filter((file) => file.startsWith('src/') || LOCKFILE.test(basename(file)));
}

export function manifestIssues(manifest) {
  const issues = [];
  if (manifest.private === true) issues.push('private: true, so npm refuses to publish it');
  const published = publishManifest(manifest);
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(published[field] ?? {})) {
      if (String(range).startsWith('workspace:')) issues.push(`${name} keeps a workspace range`);
    }
  }
  return issues;
}

const packDryRun = (dir) =>
  JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  )[0].files.map((file) => file.path);

// A missing dist file fails before packing, so the dry run reports it instead of an npm error.
export function releaseDryRun({
  root = process.cwd(),
  packages = WORKSPACE_PACKAGES,
  published = PUBLISHED_PACKAGES,
  pack = packDryRun,
} = {}) {
  const problems = [];
  for (const name of packages) {
    const dir = join(root, 'packages', name);
    const missing = missingArtifacts(dir);
    if (missing.length > 0) {
      problems.push(`${name}: missing ${missing.join(', ')}`);
      continue;
    }
    if (published.includes(name)) {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      problems.push(...manifestIssues(manifest).map((issue) => `${name}: ${issue}`));
    }
    problems.push(...tarballIssues(pack(dir)).map((file) => `${name}: the tarball carries ${file}`));
  }

  const pending = pendingPackages(join(root, '.changeset'));
  for (const name of pending) {
    if (!packages.includes(name.replace('@naulabs/', ''))) {
      problems.push(`pending changeset for ${name}, which is not a workspace package`);
    }
  }

  if (problems.length > 0) throw new Error(`release dry run failed:\n${problems.join('\n')}`);
  return { packages, published, pending: [...pending] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = releaseDryRun();
  console.log(
    `release-dry-run: ${report.packages.length} packages packed, ${report.published.length} publishable, ${report.pending.length} pending changesets`,
  );
}
