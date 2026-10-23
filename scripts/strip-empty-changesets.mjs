#!/usr/bin/env node
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// An empty changeset only satisfies the pull-request gate. The version job drops it before
// changesets/action decides whether a release pull request is needed.
const RELEASE = /^"[^"]+":\s*(?:major|minor|patch)\s*$/m;

export const isEmptyChangeset = (contents) => !RELEASE.test(contents);

export function stripEmptyChangesets(dir) {
  const removed = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const path = join(dir, file);
    if (!isEmptyChangeset(readFileSync(path, 'utf8'))) continue;
    rmSync(path);
    removed.push(file);
  }
  return removed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '.changeset';
  const removed = stripEmptyChangesets(dir);
  console.log(`strip-empty-changesets: removed ${removed.length} empty changeset(s)`);
}
