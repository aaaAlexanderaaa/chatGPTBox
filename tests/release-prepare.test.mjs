/* eslint-env node */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractReleaseNotes,
  lockfileRelativePath,
  prepareRelease,
  readLockfileVersions,
  replaceLockfileVersion,
  versionedManifestRelativePaths,
} from '../scripts/release-prepare.mjs'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

function lockfileText(rootVersion, pkgVersion = rootVersion) {
  return `${JSON.stringify(
    {
      name: 'chatgptbox',
      version: rootVersion,
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'chatgptbox',
          version: pkgVersion,
        },
        'node_modules/example': {
          version: '1.0.0',
        },
      },
    },
    null,
    2,
  )}\n`
}

async function createFixture({
  version = '4.3.5',
  manifestV2Version = version,
  lockRootVersion = version,
  lockPkgVersion = version,
  enUnreleased = '- English release note\n',
  cnUnreleased = '- 中文发布说明\n',
} = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'chatgptbox-release-'))
  await mkdir(path.join(repo, 'src'), { recursive: true })
  await writeFile(
    path.join(repo, 'package.json'),
    `${JSON.stringify({ name: 'chatgptbox', version }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    path.join(repo, 'src/manifest.json'),
    `${JSON.stringify({ manifest_version: 3, name: 'ChatGPTBox', version }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    path.join(repo, 'src/manifest.v2.json'),
    `${JSON.stringify(
      { manifest_version: 2, name: 'ChatGPTBox', version: manifestV2Version },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await writeFile(
    path.join(repo, lockfileRelativePath),
    lockfileText(lockRootVersion, lockPkgVersion),
    'utf8',
  )
  await writeFile(
    path.join(repo, 'README.md'),
    `# ChatGPTBox\n\n## Changelog\n\n### Unreleased\n\n${enUnreleased}\n### v${version}\n\n- Previous release.\n`,
    'utf8',
  )
  await writeFile(
    path.join(repo, 'README_CN.md'),
    `# ChatGPTBox\n\n## 更新日志\n\n### 尚未发布\n\n${cnUnreleased}\n### v${version}\n\n- 上一个版本。\n`,
    'utf8',
  )
  return repo
}

async function runPrepare(repo, options = {}) {
  const stdout = []
  const stderr = []
  const result = await prepareRelease({
    version: '4.3.6',
    repo,
    assertTag: async () => {},
    log: (line) => stdout.push(line),
    error: (line) => stderr.push(line),
    ...options,
  })
  return { ...result, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
}

describe('release-prepare script', () => {
  it('validates check-only without writing and updates all manifests, lockfile, and bilingual changelogs on apply', async () => {
    const repo = await createFixture()
    try {
      const check = await runPrepare(repo, { checkOnly: true })
      expect(check.ok).toBe(true)
      expect(check.stdout).toContain('would bump package.json: 4.3.5 -> 4.3.6')
      expect(check.stdout).toContain('would fold README_CN.md: ### 尚未发布 -> ### v4.3.6')
      expect(JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8')).version).toBe(
        '4.3.5',
      )

      const applied = await runPrepare(repo)
      expect(applied.ok).toBe(true)
      expect(applied.updatedCount).toBe(6)

      for (const relativePath of versionedManifestRelativePaths) {
        expect(JSON.parse(await readFile(path.join(repo, relativePath), 'utf8')).version).toBe(
          '4.3.6',
        )
      }
      const lock = await readFile(path.join(repo, lockfileRelativePath), 'utf8')
      expect(readLockfileVersions(lock)).toEqual({
        rootVersion: '4.3.6',
        rootPackageVersion: '4.3.6',
      })
      expect(JSON.parse(lock).packages['node_modules/example'].version).toBe('1.0.0')

      const en = await readFile(path.join(repo, 'README.md'), 'utf8')
      expect(en).toContain('### Unreleased\n\n### v4.3.6\n\n- English release note')
      expect(extractReleaseNotes(en, '4.3.6')).toBe('- English release note')

      const cn = await readFile(path.join(repo, 'README_CN.md'), 'utf8')
      expect(cn).toContain('### 尚未发布\n\n### v4.3.6\n\n- 中文发布说明')
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('rejects non-manifest semver, non-increasing versions, manifest/lockfile drift, existing tags, and empty changelogs', async () => {
    const repo = await createFixture()
    try {
      await expect(runPrepare(repo, { version: '4.3.6-beta.1' })).rejects.toThrow(
        /strict numeric semver/,
      )
      const same = await runPrepare(repo, { version: '4.3.5', checkOnly: true })
      expect(same.ok).toBe(false)
      expect(same.stderr).toContain('not strictly greater')

      const existingTag = await runPrepare(repo, {
        checkOnly: true,
        assertTag: async () => {
          throw new Error('git tag v4.3.6 already exists')
        },
      })
      expect(existingTag.ok).toBe(false)
      expect(existingTag.stderr).toContain('already exists')
    } finally {
      await rm(repo, { recursive: true, force: true })
    }

    const driftRepo = await createFixture({ manifestV2Version: '4.3.4', lockPkgVersion: '4.3.4' })
    try {
      const result = await runPrepare(driftRepo, { checkOnly: true })
      expect(result.ok).toBe(false)
      expect(result.stderr).toContain('manifest.v2.json')
      expect(result.stderr).toContain('package-lock.json')
    } finally {
      await rm(driftRepo, { recursive: true, force: true })
    }

    const emptyChangelogRepo = await createFixture({ enUnreleased: '\n', cnUnreleased: '\n' })
    try {
      const result = await runPrepare(emptyChangelogRepo, { checkOnly: true })
      expect(result.ok).toBe(false)
      expect(result.stderr).toContain('README.md')
      expect(result.stderr).toContain('README_CN.md')
    } finally {
      await rm(emptyChangelogRepo, { recursive: true, force: true })
    }
  })

  it('rewrites lockfile versions cleanly without touching dependency entries', () => {
    const before = lockfileText('4.3.5', '4.3.5')
    const { currentVersion, updated } = replaceLockfileVersion(before, '4.3.6')
    expect(currentVersion).toBe('4.3.5')
    expect(readLockfileVersions(updated)).toEqual({
      rootVersion: '4.3.6',
      rootPackageVersion: '4.3.6',
    })
    expect(JSON.parse(updated).packages['node_modules/example'].version).toBe('1.0.0')
  })

  it('passes check-only against the real repository workspace', async () => {
    const result = await runPrepare(repositoryRoot, { version: '99.0.0', checkOnly: true })
    expect(result.ok).toBe(true)
  })
})
