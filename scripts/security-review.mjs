#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVIEW_ROWS = 9;
const PLACEHOLDER = /^(tbd|todo|unassigned|none)$/i;
const ROW = /^\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|\s*$/gm;

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A rename from `'name'` to a backtick literal or a line break must not fail the gate.
export const namesTest = (source, name) =>
  new RegExp(`(?:it|test)\\(\\s*['"\`]${escape(name)}['"\`]`).test(source);

export function parseReview(markdown) {
  const signer = markdown.match(/^Signer:[ \t]*(.*)$/m)?.[1].trim() ?? '';
  const date = markdown.match(/^Date:[ \t]*(.*)$/m)?.[1].trim() ?? '';
  const rows = [...markdown.matchAll(ROW)].map(([, number, property, tests]) => ({
    number: Number(number),
    property: property.trim(),
    tests: tests
      .split(';')
      .map((test) => test.trim().replaceAll('`', ''))
      .filter(Boolean),
  }));
  return { signer, date, rows };
}

export function specSources(root) {
  const packagesDir = join(root, 'packages');
  return readdirSync(packagesDir)
    .flatMap((name) =>
      ['src', 'bin'].flatMap((sub) => {
        const dir = join(packagesDir, name, sub);
        if (!existsSync(dir)) return [];
        return readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((file) => join(dir, file));
      }),
    )
    .filter((file) => file.endsWith('.spec.ts'))
    .map((file) => readFileSync(file, 'utf8'));
}

export function reviewIssues(markdown, specs) {
  const { signer, date, rows } = parseReview(markdown);
  const issues = [];
  if (signer === '' || PLACEHOLDER.test(signer)) issues.push('Signer is empty');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) issues.push('Date is empty or not YYYY-MM-DD');

  const numbers = rows.map((row) => row.number).sort((a, b) => a - b);
  if (numbers.join(',') !== Array.from({ length: REVIEW_ROWS }, (_, i) => i + 1).join(',')) {
    issues.push(`expected rows 1..${REVIEW_ROWS}, got ${numbers.join(',') || 'none'}`);
  }

  for (const row of rows) {
    if (row.tests.length === 0) issues.push(`row ${row.number} names no test`);
    for (const test of row.tests) {
      if (!specs.some((source) => namesTest(source, test))) {
        issues.push(`row ${row.number} names a test that does not exist: ${test}`);
      }
    }
  }
  return issues;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const markdown = readFileSync(join(root, 'docs/auth-core-security-review.md'), 'utf8');
  const issues = reviewIssues(markdown, specSources(root));
  if (issues.length > 0) {
    console.error(`security-review: the auth-core publish is blocked\n${issues.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('security-review: signed, 9 rows, every named test exists');
  }
}
