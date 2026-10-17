import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests resolve the sibling @naulabs/* packages through their source entry: a package
// under test has no dist build, and the public barrels import each other.
const source = (name: string): string => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@naulabs/errors': source('errors') } },
  test: { passWithNoTests: true },
});
