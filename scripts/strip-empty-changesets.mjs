#!/usr/bin/env node
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangesetFile } from '@changesets/parse';

// An empty changeset only satisfies the pull-request gate. The version job drops it before
// changesets/action decides whether a release pull request is needed.
export const isEmptyChangeset = (contents) => {
  try {
    return parseChangesetFile(contents).releases.length === 0;
  } catch {
    // Not a changeset (a README, say) or malformed: changesets reports it, deleting it would hide it.
    return false;
  }
};

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
