#!/usr/bin/env node
/* eslint-env node */

import { execFile as execFileCallback } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(scriptDir, '..')

export const versionedManifestRelativePaths = [
  'package.json',
  path.join('src', 'manifest.json'),
  path.join('src', 'manifest.v2.json'),
]
export const lockfileRelativePath = 'package-lock.json'
export const changelogSpecs = [
  { relativePath: 'README.md', unreleasedHeading: '### Unreleased' },
  { relativePath: 'README_CN.md', unreleasedHeading: '### 尚未发布' },
]

const usage = `usage:
  node scripts/release-prepare.mjs <version> [--repo <path>] [--check-only]
  node scripts/release-prepare.mjs <version> --extract-notes <output-path> [--repo <path>]

Validates and prepares a ChatGPTBox release:
  1. verifies strict numeric semver X.Y.Z (required by Chromium/Firefox manifest.json),
     strictly greater than the current version, with no existing v<version> git tag
  2. checks that package.json, package-lock.json (root and packages[""]),
     src/manifest.json, and src/manifest.v2.json agree on the current version
  3. checks that README.md (### Unreleased) and README_CN.md (### 尚未发布) both
     contain non-empty release notes
  4. rewrites all four versioned files to <version> and folds both Unreleased
     sections into ### v<version>, inserting a fresh empty Unreleased heading above

options:
  --repo <path>            repository root (default: the repository containing this script)
  --check-only             validate and print the plan without writing anything
  --extract-notes <path>   write the ### v<version> section from README.md to <path>
  -h, --help               show this message

exits 0 when the plan is valid (or was applied), 1 with a clear message otherwise.
`

// Chromium and Firefox extension manifests require dot-separated numeric versions (no prerelease tag).
const manifestSemverPattern = /^(\d+)\.(\d+)\.(\d+)$/
const topLevelVersionLinePattern = /^([ \t]*)"version":\s*"([^"]*)"(,?)[ \t]*$/m

function parseSemver(version) {
  const match = manifestSemverPattern.exec(version)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return 0
}

function replaceTopLevelVersion(source, relativePath, nextVersion) {
  const match = topLevelVersionLinePattern.exec(source)
  if (!match) {
    throw new Error(`${relativePath}: no top-level "version" line found.`)
  }
  const parsed = JSON.parse(source)
  if (parsed.version !== match[2]) {
    throw new Error(
      `${relativePath}: the first "version" line (${match[2]}) is not the top-level field (${parsed.version}); refusing to edit.`,
    )
  }
  const updated = source.replace(
    topLevelVersionLinePattern,
    `${match[1]}"version": "${nextVersion}"${match[3]}`,
  )
  if (JSON.parse(updated).version !== nextVersion) {
    throw new Error(
      `${relativePath}: version rewrite did not produce the expected top-level version.`,
    )
  }
  return { currentVersion: match[2], updated }
}

export function readLockfileVersions(source, relativePath = lockfileRelativePath) {
  const parsed = JSON.parse(source)
  const rootVersion = parsed.version
  const rootPackageVersion = parsed.packages?.['']?.version
  if (typeof rootVersion !== 'string' || typeof rootPackageVersion !== 'string') {
    throw new Error(`${relativePath}: missing top-level "version" or packages[""].version.`)
  }
  return { rootVersion, rootPackageVersion }
}

export function replaceLockfileVersion(source, nextVersion, relativePath = lockfileRelativePath) {
  const { rootVersion, rootPackageVersion } = readLockfileVersions(source, relativePath)
  if (rootVersion !== rootPackageVersion) {
    throw new Error(
      `${relativePath}: top-level version (${rootVersion}) disagrees with packages[""].version (${rootPackageVersion}).`,
    )
  }
  const first = replaceTopLevelVersion(source, relativePath, nextVersion)
  const packagesBlockPattern =
    /("packages":\s*\{\s*\n\s*"":\s*\{[\s\S]*?\n([ \t]*))"version":\s*"([^"]*)"(,?)/
  const blockMatch = packagesBlockPattern.exec(first.updated)
  if (!blockMatch || blockMatch[3] !== rootPackageVersion) {
    throw new Error(
      `${relativePath}: could not locate packages[""].version matching ${rootPackageVersion}.`,
    )
  }
  const updated = first.updated.replace(packagesBlockPattern, `$1"version": "${nextVersion}"$4`)
  const after = readLockfileVersions(updated, relativePath)
  if (after.rootVersion !== nextVersion || after.rootPackageVersion !== nextVersion) {
    throw new Error(`${relativePath}: lockfile version rewrite did not update both root fields.`)
  }
  return { currentVersion: rootVersion, updated }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findHeadingSection(lines, heading) {
  const startPattern = new RegExp(`^${escapeRegex(heading)}[ \\t]*$`)
  const start = lines.findIndex((line) => startPattern.test(line))
  if (start === -1) return undefined
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##(?: |#)/.test(lines[index])) {
      end = index
      break
    }
  }
  return { start, end }
}

function sectionHasContent(lines, section) {
  return lines
    .slice(section.start + 1, section.end)
    .some((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
}

export function foldChangelog(source, unreleasedHeading, version) {
  const lines = source.split('\n')
  const section = findHeadingSection(lines, unreleasedHeading)
  if (!section) throw new Error(`Missing "${unreleasedHeading}" heading.`)
  const folded = [
    ...lines.slice(0, section.start),
    unreleasedHeading,
    '',
    `### v${version}`,
    ...lines.slice(section.start + 1),
  ]
  return folded.join('\n')
}

export function extractReleaseNotes(readmeSource, version) {
  const lines = readmeSource.split('\n')
  const section = findHeadingSection(lines, `### v${version}`)
  if (!section) return ''
  return lines
    .slice(section.start + 1, section.end)
    .join('\n')
    .trim()
}

async function assertTagAbsent(repoRoot, tag) {
  let stdout = ''
  try {
    const result = await execFile('git', ['tag', '-l', tag], { cwd: repoRoot })
    stdout = result.stdout
  } catch (error) {
    throw new Error(
      `could not run "git tag -l ${tag}" in ${repoRoot} (${error.message}); the tag check is mandatory.`,
    )
  }
  if (stdout.trim() !== '') {
    throw new Error(`git tag ${tag} already exists; a version can only be released once.`)
  }
}

function parseArgs(argv) {
  const parsed = {
    version: undefined,
    repo: undefined,
    checkOnly: false,
    extractNotes: undefined,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--repo' && argv[index + 1]) parsed.repo = argv[++index]
    else if (argument.startsWith('--repo=')) parsed.repo = argument.slice('--repo='.length)
    else if (argument === '--check-only') parsed.checkOnly = true
    else if (argument === '--extract-notes' && argv[index + 1]) parsed.extractNotes = argv[++index]
    else if (argument.startsWith('--extract-notes='))
      parsed.extractNotes = argument.slice('--extract-notes='.length)
    else if (argument === '--help' || argument === '-h') parsed.help = true
    else if (!argument.startsWith('-') && parsed.version === undefined) parsed.version = argument
    else throw new Error(`unknown or duplicate argument: ${argument}`)
  }
  return parsed
}

export async function prepareRelease({
  version,
  repo = defaultRepoRoot,
  checkOnly = false,
  assertTag = assertTagAbsent,
  log = console.log,
  error = console.error,
} = {}) {
  if (!version) {
    throw new Error('missing required <version> argument.')
  }

  const repoRoot = path.resolve(repo)
  const nextVersion = parseSemver(version)
  if (!nextVersion) {
    throw new Error(
      `version "${version}" is not strict numeric semver; expected X.Y.Z (Chromium/Firefox manifests forbid prerelease suffixes).`,
    )
  }

  const packageSource = await readFile(path.join(repoRoot, 'package.json'), 'utf8')
  const currentVersion = JSON.parse(packageSource).version
  const currentParsed = parseSemver(currentVersion)
  if (!currentParsed) {
    throw new Error(
      `package.json: current version "${currentVersion}" is not parseable X.Y.Z semver.`,
    )
  }

  const problems = []
  if (compareSemver(nextVersion, currentParsed) <= 0) {
    problems.push(
      `version ${version} is not strictly greater than the current version ${currentVersion}.`,
    )
  }

  const manifestSources = new Map()
  for (const relativePath of versionedManifestRelativePaths) {
    try {
      const source = await readFile(path.join(repoRoot, relativePath), 'utf8')
      manifestSources.set(relativePath, source)
      const manifestVersion = JSON.parse(source).version
      if (manifestVersion !== currentVersion) {
        problems.push(
          `${relativePath} is at ${manifestVersion} while package.json is at ${currentVersion}; all versioned manifests must agree before a release.`,
        )
      }
    } catch (caught) {
      problems.push(`${relativePath}: ${caught instanceof Error ? caught.message : String(caught)}`)
    }
  }

  let lockfileSource = ''
  try {
    lockfileSource = await readFile(path.join(repoRoot, lockfileRelativePath), 'utf8')
    const { rootVersion, rootPackageVersion } = readLockfileVersions(
      lockfileSource,
      lockfileRelativePath,
    )
    if (rootVersion !== currentVersion || rootPackageVersion !== currentVersion) {
      problems.push(
        `${lockfileRelativePath} is at ${rootVersion} / packages[""]=${rootPackageVersion} while package.json is at ${currentVersion}; lockfile versions must agree before a release.`,
      )
    }
  } catch (caught) {
    problems.push(caught instanceof Error ? caught.message : String(caught))
  }

  try {
    await assertTag(repoRoot, `v${version}`)
  } catch (caught) {
    problems.push(caught instanceof Error ? caught.message : String(caught))
  }

  const changelogSources = new Map()
  for (const { relativePath, unreleasedHeading } of changelogSpecs) {
    try {
      const source = await readFile(path.join(repoRoot, relativePath), 'utf8')
      changelogSources.set(relativePath, source)
      const lines = source.split('\n')
      const section = findHeadingSection(lines, unreleasedHeading)
      if (!section) {
        problems.push(`${relativePath}: no "${unreleasedHeading}" section found.`)
      } else if (!sectionHasContent(lines, section)) {
        problems.push(
          `${relativePath}: the "${unreleasedHeading}" section has no content; accumulate release notes there before cutting a release.`,
        )
      }
      if (findHeadingSection(lines, `### v${version}`)) {
        problems.push(`${relativePath}: a "### v${version}" section already exists.`)
      }
    } catch (caught) {
      problems.push(`${relativePath}: ${caught instanceof Error ? caught.message : String(caught)}`)
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) error(`error: ${problem}`)
    return { ok: false, problems }
  }

  const mode = checkOnly ? 'check-only plan' : 'release preparation'
  log(`[chatgptbox] ${mode} for v${version} (current ${currentVersion})`)
  for (const relativePath of versionedManifestRelativePaths) {
    log(
      `[chatgptbox] ${
        checkOnly ? 'would bump' : 'bumped'
      } ${relativePath}: ${currentVersion} -> ${version}`,
    )
  }
  log(
    `[chatgptbox] ${
      checkOnly ? 'would bump' : 'bumped'
    } ${lockfileRelativePath}: ${currentVersion} -> ${version}`,
  )
  for (const { relativePath, unreleasedHeading } of changelogSpecs) {
    log(
      `[chatgptbox] ${
        checkOnly ? 'would fold' : 'folded'
      } ${relativePath}: ${unreleasedHeading} -> ### v${version}`,
    )
  }

  if (checkOnly) {
    log('[chatgptbox] check-only: no files written.')
    return { ok: true, checkOnly, version, currentVersion }
  }

  for (const relativePath of versionedManifestRelativePaths) {
    const { updated } = replaceTopLevelVersion(
      manifestSources.get(relativePath),
      relativePath,
      version,
    )
    await writeFile(path.join(repoRoot, relativePath), updated, 'utf8')
  }
  const { updated: updatedLockfile } = replaceLockfileVersion(
    lockfileSource,
    version,
    lockfileRelativePath,
  )
  await writeFile(path.join(repoRoot, lockfileRelativePath), updatedLockfile, 'utf8')

  for (const { relativePath, unreleasedHeading } of changelogSpecs) {
    const folded = foldChangelog(changelogSources.get(relativePath), unreleasedHeading, version)
    await writeFile(path.join(repoRoot, relativePath), folded, 'utf8')
  }

  const updatedCount = versionedManifestRelativePaths.length + 1 + changelogSpecs.length
  log(`[chatgptbox] release preparation complete: ${updatedCount} files updated.`)
  return { ok: true, checkOnly, version, currentVersion, updatedCount }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage)
    return
  }
  if (!args.version) {
    console.error('error: missing required <version> argument.\n')
    console.error(usage)
    process.exitCode = 1
    return
  }

  const repoRoot = path.resolve(args.repo || defaultRepoRoot)
  if (args.extractNotes) {
    if (!parseSemver(args.version)) {
      throw new Error(`version "${args.version}" is not strict numeric semver X.Y.Z.`)
    }
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8')
    const notes = extractReleaseNotes(readme, args.version)
    if (!notes) {
      throw new Error(`README.md: could not find non-empty "### v${args.version}" release notes.`)
    }
    await writeFile(args.extractNotes, `${notes}\n`, 'utf8')
    console.log(`[chatgptbox] extracted release notes for v${args.version} to ${args.extractNotes}`)
    return
  }

  const result = await prepareRelease({
    version: args.version,
    repo: repoRoot,
    checkOnly: args.checkOnly,
  })
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((caught) => {
    console.error(`error: ${caught instanceof Error ? caught.message : String(caught)}`)
    process.exitCode = 1
  })
}
