import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// `**/src/**` catches a relative import across packages (e.g. `../../config/src/index`);
// the two `@naulabsco/*` groups catch the bare and slash forms a named deep import takes.
export const deepImportPatterns = [
  {
    group: ['@naulabsco/*/src', '@naulabsco/*/src/*', '@naulabsco/*/dist', '@naulabsco/*/dist/*', '**/src/**'],
    message: 'Import the package root (@naulabsco/<name>); deep paths and raw sources are not public.',
  },
];

export const portImportPatterns = [
  ...deepImportPatterns,
  { group: ['@nestjs/*'], message: 'A port imports no framework.' },
  {
    group: ['pg', 'postgres', 'mysql2', 'ioredis', 'mongodb', 'better-sqlite3'],
    message: 'A port imports no database driver.',
  },
];

// A dynamic import would let a framework or driver past the static patterns above.
export const portSyntaxPatterns = [
  { selector: 'ImportExpression', message: 'A port loads no module dynamically.' },
];

// `moduleResolution: bundler` resolves a relative import without one; an extension couples the
// specifier to the file layout, and the tsup bundle inlines relative imports anyway.
export const extensionPatterns = [
  {
    group: ['./**/*.js', './**/*.ts', '../**/*.js', '../**/*.ts'],
    message: 'Drop the extension from a relative import; the bundler resolves it.',
  },
];

const restrictedImports = (patterns) => ['error', { patterns }];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '.nx/**',
      '.pack-smoke/**',
      '.build-fixture/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-imports': restrictedImports(extensionPatterns),
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
    rules: { 'no-restricted-imports': restrictedImports([...deepImportPatterns, ...extensionPatterns]) },
  },
  {
    files: ['packages/*/src/ports/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([...portImportPatterns, ...extensionPatterns]),
      'no-restricted-syntax': ['error', ...portSyntaxPatterns],
    },
  },
);
