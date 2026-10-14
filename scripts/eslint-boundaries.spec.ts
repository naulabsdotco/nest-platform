import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import config, { deepImportPatterns, portImportPatterns, portSyntaxPatterns } from '../eslint.config.mjs';

const boundaryConfig = (rules: unknown): unknown[] => [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, rules },
];

const lint = (code: string, filename: string, rules: unknown): string[] =>
  new Linter({ configType: 'flat' })
    .verify(code, boundaryConfig(rules) as never, { filename })
    .map((message) => message.ruleId ?? message.message);

const portRules = {
  'no-restricted-imports': ['error', { patterns: portImportPatterns }],
  'no-restricted-syntax': ['error', ...portSyntaxPatterns],
};
const sourceRules = { 'no-restricted-imports': ['error', { patterns: deepImportPatterns }] };
const port = 'packages/config/src/ports/store.ts';

describe('eslint package boundaries', () => {
  it('rejects a framework import under ports', () => {
    expect(lint("import { Injectable } from '@nestjs/common';", port, portRules)).toContain(
      'no-restricted-imports',
    );
  });

  it('rejects a bare, slashed and relative deep import', () => {
    expect(lint("import x from '@naulabs/config/src';", port, portRules)).toContain('no-restricted-imports');
    expect(lint("import x from '@naulabs/config/src/index';", port, portRules)).toContain('no-restricted-imports');
    expect(lint("import x from '../../../config/src/index';", port, portRules)).toContain('no-restricted-imports');
  });

  it('rejects a dynamic import under ports', () => {
    expect(lint("const m = await import('@nestjs/core');", port, portRules)).toContain('no-restricted-syntax');
  });

  it('rejects a deep import outside ports', () => {
    expect(
      lint("import x from '@naulabs/config/src/index';", 'packages/config/src/index.ts', sourceRules),
    ).toContain('no-restricted-imports');
  });

  it('allows a package root and a node builtin', () => {
    expect(lint("import x from '@naulabs/config';\nimport p from 'node:path';", port, portRules)).toEqual([]);
  });

  it('keeps the boundary rules wired into the default config', () => {
    const ports = config.find((entry) => entry.files?.some((file) => file.includes('ports')));
    const rules = (ports?.rules ?? {}) as Record<string, unknown>;

    expect((rules['no-restricted-imports'] as unknown[])[1]).toEqual({ patterns: portImportPatterns });
    expect((rules['no-restricted-syntax'] as unknown[])[1]).toBe(portSyntaxPatterns[0]);
  });
});
