/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(root, relative), 'utf8'))
}

describe('frozen release version', () => {
  const pkg = readJson('package.json')
  const chromium = readJson('src/manifest.json')
  const firefox = readJson('src/manifest.v2.json')

  it('keeps package.json and both manifests on the same version', () => {
    expect(chromium.version).toBe(pkg.version)
    expect(firefox.version).toBe(pkg.version)
  })

  it('documents that version in both README changelogs', () => {
    const heading = `### v${pkg.version}`
    expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toContain(heading)
    expect(readFileSync(path.join(root, 'README_CN.md'), 'utf8')).toContain(heading)
  })
})
