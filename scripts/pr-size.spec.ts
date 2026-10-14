import { describe, expect, it } from 'vitest';
import { HARD_CAP, countChangedLines, evaluateSize } from './pr-size.mjs';

const numstat = (rows: Array<[number, number, string]>): string =>
  rows.map(([added, deleted, file]) => `${added}\t${deleted}\t${file}`).join('\n');

describe('pr-size', () => {
  it('fails a diff over the hard cap', () => {
    const result = evaluateSize(numstat([[400, 200, 'packages/config/src/index.ts']]));

    expect(result.changed).toBe(600);
    expect(result.ok).toBe(false);
  });

  it('passes a diff within the target', () => {
    const result = evaluateSize(numstat([[80, 40, 'packages/config/src/index.ts']]));

    expect(result.changed).toBe(120);
    expect(result.ok).toBe(true);
  });

  it('excludes lockfile lines from the count', () => {
    const diff = numstat([
      [600, 0, 'pnpm-lock.yaml'],
      [40, 10, 'packages/config/src/index.ts'],
    ]);

    expect(countChangedLines(diff)).toBe(50);
    expect(evaluateSize(diff).ok).toBe(true);
    expect(HARD_CAP).toBe(500);
  });
});
