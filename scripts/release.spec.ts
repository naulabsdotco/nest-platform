import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACTS,
  PUBLISHED_PACKAGES,
  WORKSPACE_PACKAGES,
  manifestIssues,
  missingArtifacts,
  pendingPackages,
  releaseDryRun,
  tarballIssues,
} from './release-dry-run.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHANGESET = join(ROOT, 'node_modules/@changesets/cli/bin.js');
const created: string[] = [];

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'release-'));
  created.push(dir);
  return dir;
};

const write = (path: string, contents: string): Promise<void> => writeFile(path, contents);

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const workflow = (): Promise<string> =>
  readFile(join(ROOT, '.github/workflows/release.yml'), 'utf8');

describe('release dry run', () => {
  it('the release workflow packs every package and fails on a missing dist file', async () => {
    expect(await workflow()).toContain('node scripts/release-dry-run.mjs');

    const root = await tempDir();
    const dir = join(root, 'packages/config');
    await mkdir(dir, { recursive: true });

    expect(missingArtifacts(dir)).toEqual(ARTIFACTS);
    expect(() =>
      releaseDryRun({ root, packages: ['config'], published: [], pack: () => [] }),
    ).toThrow(/config: missing dist\/esm\/index\.js/);
  });

  it('a package with a pending changeset but no dist fails the dry run', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.changeset'), { recursive: true });
    await mkdir(join(root, 'packages/config'), { recursive: true });
    await write(join(root, 'packages/config/package.json'), '{"name":"@naulabs/config"}');
    await write(join(root, '.changeset/pending.md'), '---\n"@naulabs/config": minor\n---\n\nchange\n');

    expect([...pendingPackages(join(root, '.changeset'))]).toEqual(['@naulabs/config']);
    expect(() =>
      releaseDryRun({ root, packages: ['config'], published: [], pack: () => [] }),
    ).toThrow(/config: missing dist\/esm\/index\.js/);
  });

  it('changeset status is clean after versioning', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.changeset'), { recursive: true });
    await mkdir(join(root, 'packages/config'), { recursive: true });
    await write(
      join(root, 'package.json'),
      '{"name":"fixture","private":true,"workspaces":["packages/*"]}',
    );
    await write(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    await write(
      join(root, 'packages/config/package.json'),
      '{"name":"@naulabs/config","version":"0.0.0","private":false}',
    );
    await write(
      join(root, '.changeset/config.json'),
      JSON.stringify({
        changelog: '@changesets/cli/changelog',
        commit: false,
        fixed: [],
        access: 'public',
        baseBranch: 'main',
        updateInternalDependencies: 'patch',
        ignore: [],
      }),
    );
    await write(join(root, '.changeset/pending.md'), '---\n"@naulabs/config": minor\n---\n\nchange\n');

    execFileSync(process.execPath, [CHANGESET, 'version'], { cwd: root, stdio: 'pipe' });

    expect([...pendingPackages(join(root, '.changeset'))]).toEqual([]);
    const manifest = JSON.parse(await readFile(join(root, 'packages/config/package.json'), 'utf8'));
    expect(manifest.version).toBe('0.1.0');
  });

  it('the published tarball carries no source outside dist and no lockfile', async () => {
    expect(tarballIssues(['dist/esm/index.js', 'README.md', 'package.json'])).toEqual([]);
    expect(tarballIssues(['src/index.ts', 'pnpm-lock.yaml'])).toEqual(['src/index.ts', 'pnpm-lock.yaml']);

    const dir = await tempDir();
    await mkdir(join(dir, 'dist/esm'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await write(join(dir, 'dist/esm/index.js'), 'export {};\n');
    await write(join(dir, 'src/index.ts'), 'export {};\n');
    await write(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await write(
      join(dir, 'package.json'),
      '{"name":"@fixture/pack","version":"1.0.0","files":["dist","src","pnpm-lock.yaml"]}',
    );

    const packed = JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )[0].files.map((file: { path: string }) => file.path);

    expect(packed).toContain('src/index.ts');
    expect(tarballIssues(packed)).toEqual(['src/index.ts']);
  });

  it('the published tarball resolves under both require() and import()', async () => {
    for (const name of PUBLISHED_PACKAGES) {
      const manifest = JSON.parse(
        await readFile(join(ROOT, `packages/${name}/package.json`), 'utf8'),
      );

      expect(manifest.private).not.toBe(true);
      expect(manifest.exports['.'].import.default).toBe('./dist/esm/index.js');
      expect(manifest.exports['.'].require.default).toBe('./dist/cjs/index.js');
      expect(manifestIssues(manifest)).toEqual([]);
    }
    expect(await workflow()).toContain('node scripts/pack-smoke.mjs');
    expect(WORKSPACE_PACKAGES).toHaveLength(4);
  });
});

describe('release workflow', () => {
  it('opens a version pull request instead of pushing a version commit to main', async () => {
    const config = await workflow();

    expect(config).toContain('uses: changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51');
    expect(config).toContain("pr-title: 'chore(release): version packages'");
    expect(config).toContain('pr-base-branch: main');
    expect(config).toContain("if: github.head_ref != 'changeset-release/main'");
    expect(config).not.toContain('publish-script');
    expect(config).not.toContain('git push');
    expect(config).not.toContain('[skip ci]');
  });

  it('uses RELEASE_TOKEN when the owner sets it so CI runs on the release pull request', async () => {
    expect(await workflow()).toContain(
      'github-token: ${{ secrets.RELEASE_TOKEN || github.token }}',
    );
  });

  it('publishes only when no changesets remain, behind the npm-publish gate', async () => {
    const config = await workflow();

    expect(config).toContain("needs.version.outputs['has-changesets'] == 'false'");
    expect(config).toContain('environment: npm-publish');
    expect(config).toContain('pnpm exec changeset publish');
    expect(config).toContain("PNPM_CONFIG_PROVENANCE: 'true'");
    expect(config).toContain("if: env.NPM_TOKEN != ''");
  });
});
