import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const deepImport = {
  group: ['@naulabs/*/src/*', '@naulabs/*/dist/*'],
  message: 'Import the package root (@naulabs/<name>); deep paths are not public.',
};
const framework = { group: ['@nestjs/*'], message: 'A port imports no framework.' };
const drivers = {
  group: ['pg', 'postgres', 'mysql2', 'ioredis', 'mongodb', 'better-sqlite3'],
  message: 'A port imports no database driver.',
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', '.nx/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/*/src/ports/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [deepImport, framework, drivers] }],
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
    ignores: ['packages/*/src/ports/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [deepImport] }] },
  },
);
