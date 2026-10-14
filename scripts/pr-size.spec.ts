import { describe, expect, it } from 'vitest';
import { countChangedLines, evaluateSize } from './pr-size.mjs';

const numstat = (rows: Array<[string, string, string]>): string =>
  rows.map(([added, deleted, file]) => `${added}\t${deleted}\t${file}`).join('\n');

describe('pr-size', () => {
  it('fails a diff over the hard cap', () => {
    const result = evaluateSize(numstat([['400', '200', 'packages/config/src/index.ts']]));

    expect(result.changed).toBe(600);
    expect(result.ok).toBe(false);
  });

  it('passes a diff within the target', () => {
    const result = evaluateSize(numstat([['80', '40', 'packages/config/src/index.ts']]));

    expect(result.changed).toBe(120);
    expect(result.ok).toBe(true);
  });

  it('passes at 500 changed lines and fails at 501', () => {
    expect(evaluateSize(numstat([['400', '100', 'a.ts']])).ok).toBe(true);
    expect(evaluateSize(numstat([['400', '101', 'a.ts']])).ok).toBe(false);
  });

  it('excludes lockfile lines from the count', () => {
    const diff = numstat([
      ['600', '0', 'pnpm-lock.yaml'],
      ['40', '10', 'packages/config/src/index.ts'],
    ]);

    expect(countChangedLines(diff)).toBe(50);
    expect(evaluateSize(diff).ok).toBe(true);
  });

  it('does not exclude a file whose name merely ends with a lockfile name', () => {
    expect(countChangedLines(numstat([['10', '0', 'not-pnpm-lock.yaml']]))).toBe(10);
  });

  it('skips binary rows', () => {
    expect(countChangedLines(numstat([['-', '-', 'logo.png'], ['10', '5', 'a.ts']]))).toBe(15);
  });
});
