import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (name: string): string => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@naulabsco/errors': source('errors') } },
  test: { passWithNoTests: true },
});
