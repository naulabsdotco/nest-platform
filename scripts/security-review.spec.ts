import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { namesTest, parseReview, reviewIssues, specSources } from './security-review.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REVIEW = join(ROOT, 'docs/auth-core-security-review.md');

const markdown = (): Promise<string> => readFile(REVIEW, 'utf8');
const specs = (): string[] => specSources(ROOT);

describe('auth-core security review', () => {
  it('the auth-core publish is gated on a signed security review', async () => {
    expect(reviewIssues(await markdown(), specs())).toEqual([]);

    const unsigned = (await markdown()).replace(/^Signer:.*$/m, 'Signer:');
    expect(reviewIssues(unsigned, specs()).join('\n')).toMatch(/Signer is empty/);

    const workflow = await readFile(join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(workflow).toMatch(/^ {2}security-review:\n {4}runs-on:/m);
    expect(workflow).toMatch(/^ {4}needs: security-review$/m);
    expect(workflow).toMatch(/^ {4}environment: npm-publish$/m);
    expect(await readFile(join(ROOT, 'SECURITY.md'), 'utf8')).toMatch(/required reviewers/);
  });

  it('every review row names a test that exists in the package', async () => {
    const rows = parseReview(await markdown()).rows;

    expect(rows).toHaveLength(9);
    for (const row of rows) {
      for (const test of row.tests) expect(specs().join('\n')).toContain(test);
    }
  });

  it('a row naming a test that no longer exists fails the gate', async () => {
    const rows = parseReview(await markdown()).rows;
    const stale = (await markdown()).replace(rows[0].tests[0], 'a test that was deleted');

    expect(reviewIssues(stale, specs()).join('\n')).toMatch(/row 1 names a test that does not exist/);
  });

  it('matches a named test in any quote style or line break', () => {
    expect(namesTest('it(`a backtick test`, () => {})', 'a backtick test')).toBe(true);
    expect(namesTest("it(\n  'a multiline test',\n  () => {})", 'a multiline test')).toBe(true);
    expect(namesTest("it('another test', () => {})", 'a missing test')).toBe(false);
  });
});
