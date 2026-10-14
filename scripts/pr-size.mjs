#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGET = 200;
export const HARD_CAP = 500;

const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json']);

export function countChangedLines(numstat) {
  let total = 0;
  for (const line of numstat.split('\n')) {
    const [added, deleted, file] = line.trim().split('\t');
    if (!file) continue;
    if (LOCKFILES.has(basename(file))) continue;
    if (added === '-' || deleted === '-') continue;
    total += Number(added) + Number(deleted);
  }
  return total;
}

export function evaluateSize(numstat, cap = HARD_CAP) {
  const changed = countChangedLines(numstat);
  return { changed, ok: changed <= cap };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] ?? 'main';
  const numstat = execFileSync('git', ['diff', '--numstat', `${base}...HEAD`, '--', '.'], {
    encoding: 'utf8',
  });
  const { changed, ok } = evaluateSize(numstat);
  const note = changed > TARGET ? ` (over the ${TARGET}-line target)` : '';
  if (!ok) {
    console.error(`pr-size: ${changed} changed lines exceeds the ${HARD_CAP}-line hard cap`);
    process.exit(1);
  }
  console.log(`pr-size: ${changed} changed lines${note}`);
}
