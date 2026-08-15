/* eslint-env node */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The module seam's structural guarantee (roadmap A1): modules may only
// import `api.mjs` from the extension core, and core code may only reach
// modules through the four aggregation files. eslint enforces the same rule
// (see .eslintrc.json overrides); this test walks the tree so CI catches a
// violation even when the lint step was skipped.

const root = path.resolve(process.cwd(), 'src')
const modulesDir = path.join(root, 'modules')
const seam = path.join(modulesDir, 'api.mjs')

const AGGREGATION_BASENAMES = new Set([
  'api.mjs',
  'index.mjs',
  'background-services.mjs',
  'settings-cards.mjs',
])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(mjs|jsx|js)$/.test(name)) yield full
  }
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g

function importsOf(file) {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(IMPORT_RE)].map((match) => match[1])
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  return path.resolve(path.dirname(fromFile), specifier)
}

describe('module boundary', () => {
  const moduleFiles = [...walk(modulesDir)]

  it('found the module tree', () => {
    expect(moduleFiles.length).toBeGreaterThan(0)
  })

  it.each(moduleFiles.map((file) => [path.relative(root, file), file]))(
    '%s imports only the seam from the core',
    (_relative, file) => {
      if (AGGREGATION_BASENAMES.has(path.basename(file)) && path.dirname(file) === modulesDir) {
        return
      }
      for (const specifier of importsOf(file)) {
        const resolved = resolveSpecifier(file, specifier)
        if (!resolved) continue
        const escapesModule =
          !resolved.startsWith(`${modulesDir}${path.sep}`) && resolved !== modulesDir
        if (escapesModule && resolved !== seam) {
          expect.unreachable(
            `"${specifier}" escapes the module; import the seam (api.mjs) or take an injected dependency`,
          )
        }
      }
    },
  )

  it('core files reach modules only through the aggregation files', () => {
    const coreFiles = [...walk(root)].filter((file) => !file.startsWith(modulesDir))
    for (const file of coreFiles) {
      for (const specifier of importsOf(file)) {
        const resolved = resolveSpecifier(file, specifier)
        if (!resolved) continue
        const inModules = resolved === modulesDir || resolved.startsWith(`${modulesDir}${path.sep}`)
        if (!inModules) continue
        const basename = path.basename(resolved)
        const isAggregation = resolved === modulesDir || AGGREGATION_BASENAMES.has(basename)
        // Aggregation basenames deeper inside modules/ (e.g. some module's own
        // index.mjs) are still module internals — only the top-level files count.
        const isTopLevel = path.dirname(resolved) === modulesDir
        expect(
          isAggregation &&
            (!AGGREGATION_BASENAMES.has(basename) || isTopLevel || resolved === modulesDir),
          `${path.relative(root, file)} reaches into modules via "${specifier}"`,
        ).toBe(true)
      }
    }
  })
})
