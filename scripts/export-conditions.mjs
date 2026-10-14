import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PACKAGES = ['config', 'logging', 'errors', 'auth-core'];

export function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
}

const DIST = { import: '/dist/esm/index.js', require: '/dist/cjs/index.js' };
const TYPES = { import: '.d.ts', require: '.d.cts' };

// A key exported by both formats must carry the same typeof; a mismatch means the
// builds expose different values under one name.
export function typeMismatches(esm, cjs) {
  const mismatches = [];
  for (const key of Object.keys(esm)) {
    if (typeof cjs[key] !== typeof esm[key]) {
      mismatches.push(`${key}: ${typeof esm[key]} vs ${typeof cjs[key]}`);
    }
  }
  return mismatches;
}

export function checkExports(name, pkg, packageDir) {
  const entry = pkg.exports?.['.'] ?? {};
  const problems = [];
  if (entry['@naulabs/source'] !== './src/index.ts') {
    problems.push(`${name}: @naulabs/source must point at ./src/index.ts`);
  }
  for (const condition of ['import', 'require']) {
    const target = entry[condition];
    if (!target?.default?.endsWith(DIST[condition])) {
      problems.push(`${name}: ${condition}.default must end with ${DIST[condition]}`);
    } else if (!existsSync(join(packageDir, target.default))) {
      problems.push(`${name}: ${condition}.default is missing on disk`);
    }
    if (!target?.types?.endsWith(TYPES[condition])) {
      problems.push(`${name}: ${condition}.types must end with ${TYPES[condition]}`);
    } else if (!existsSync(join(packageDir, target.types))) {
      problems.push(`${name}: ${condition}.types is missing on disk`);
    }
  }
  return problems;
}
