import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain';

const domainEntry = resolve(dirname(fileURLToPath(import.meta.url)), 'domain.ts');
const importSpecifier = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
const forbidden = [/^@nestjs\//, /^(pg|postgres|mysql2|ioredis|mongodb|better-sqlite3)$/];

const moduleGraph = (entry: string) => {
  const files = new Set<string>();
  const external = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (files.has(file)) continue;
    files.add(file);

    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(importSpecifier)) {
      if (specifier.startsWith('.')) pending.push(resolve(dirname(file), `${specifier}.ts`));
      else external.add(specifier);
    }
  }

  return [...external];
};

describe('domain entry', () => {
  it('DomainError is exported and usable', () => {
    class SampleFailed extends DomainError {
      readonly code = 'SAMPLE_FAILED';
    }

    const error = new SampleFailed({ field: 'name' });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('SAMPLE_FAILED');
    expect(error.criteria).toEqual({ field: 'name' });
  });

  it('its module graph imports no framework or database driver', () => {
    const leaked = moduleGraph(domainEntry).filter((specifier) =>
      forbidden.some((pattern) => pattern.test(specifier)),
    );

    expect(leaked).toEqual([]);
  });
});
