import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_CONDITION = '@naulabs/source';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// `workspace:` is a monorepo-only alias; a consumer's npm cannot resolve it, so it is rewritten to
// the same version the package is being published at.
const resolveWorkspaceRanges = (pkg) => {
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
      const suffix = range.slice('workspace:'.length);
      deps[name] = suffix === '*' || suffix === '^' || suffix === '~' ? `${suffix === '*' ? '' : suffix}${pkg.version}` : suffix;
    }
  }
};

// The dev condition and the raw sources must not reach a consumer: the condition would load
// TypeScript out of node_modules, and `src` is not part of the published surface.
export function publishManifest(manifest) {
  const pkg = structuredClone(manifest);
  const entry = pkg.exports?.['.'];
  if (entry) delete entry[SOURCE_CONDITION];
  pkg.files = (pkg.files ?? []).filter((file) => file !== 'src');
  resolveWorkspaceRanges(pkg);
  return pkg;
}

const dir = process.argv[3] ?? process.cwd();
const manifestPath = join(dir, 'package.json');
const backupPath = join(dir, '.publish-backup.json');

const restore = () => {
  if (!existsSync(backupPath)) return;
  writeFileSync(manifestPath, readFileSync(backupPath, 'utf8'));
  rmSync(backupPath);
};

const strip = () => {
  restore();
  writeFileSync(backupPath, readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify(publishManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))), null, 2)}\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action === 'strip') strip();
  else if (action === 'restore') restore();
  else throw new Error(`unknown action: ${action}`);
}
