/* global process */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Contract test: every feature-flag stub must declare the same set of export
// names as the real module it shadows. This catches the case where someone
// adds an export to a real module (e.g. services/agent-context.mjs) but forgets
// to mirror it in the stub — a drift that only surfaces in production builds
// (where the stub is swapped in) as a silent undefined import.
//
// We parse export names STATICALLY from source rather than importing the
// modules. Two reasons:
//   1. The real modules participate in an existing ESM cycle
//      (config <-> model-name-convert) that is tolerated by webpack but throws
//      under vitest's strict SSR module loading.
//   2. The contract we care about is the declared surface, not the runtime
//      object — a name present in source but dropped by tree-shaking would
//      still be importable by callers, which is what matters.
//
// We assert only the NAME SET, not arity/behavior. Some stubs intentionally
// reduce arity (session-state's mutation helpers become 1-arg no-ops) and
// skills/importer intentionally throws 'disabled' — both by design.

const pairs = [
  {
    name: 'agent-context',
    real: 'src/services/agent-context.mjs',
    stub: 'src/stubs/agent-context.stub.mjs',
  },
  {
    name: 'agent/session-state',
    real: 'src/services/agent/session-state.mjs',
    stub: 'src/stubs/session-state.stub.mjs',
  },
  {
    name: 'mcp/tool-loop',
    real: 'src/services/mcp/tool-loop.mjs',
    stub: 'src/stubs/mcp-tool-loop.stub.mjs',
  },
  {
    name: 'skills/importer',
    real: 'src/services/skills/importer.mjs',
    stub: 'src/stubs/skills-importer.stub.mjs',
  },
  {
    name: 'AgentsTab',
    real: 'src/popup/components/AgentsTab.jsx',
    stub: 'src/stubs/agents-tab.stub.jsx',
  },
]

/**
 * Statically extract the set of exported names from a module's source text.
 * Handles the common forms:
 *   export { a, b, c }                       (optionally with `as` aliases)
 *   export { a, b } from '...'               (re-export)
 *   export const x = ...
 *   export let y
 *   export function f() {}
 *   export async function g() {}
 *   export class C {}
 *   export default ...                       (included as 'default')
 */
function extractExportNames(source) {
  const names = new Set()
  // `export { ... }` and `export { ... } from '...'` (possibly multi-line)
  for (const match of source.matchAll(/export\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?/g)) {
    const body = match[1]
    for (const piece of body.split(',')) {
      const trimmed = piece.trim()
      if (!trimmed) continue
      // `local as exported` -> take the exported name (last identifier)
      const asMatch = trimmed.match(/\bas\s+([A-Za-z_$][\w$]*)/)
      const ident = asMatch ? asMatch[1] : trimmed.match(/^([A-Za-z_$][\w$]*)/)?.[1]
      if (ident) names.add(ident)
    }
  }
  // `export const/let/var/function/async function/class NAME`
  const declRe = /export\s+(?:const|let|var|function|async\s+function|class)\s+([A-Za-z_$][\w$]*)/g
  for (const match of source.matchAll(declRe)) names.add(match[1])
  // `export default`
  if (/export\s+default\b/.test(source)) names.add('default')
  return names
}

describe('feature-flag stub contract', () => {
  for (const { name, real, stub } of pairs) {
    it(`${name}: stub declares the same export names as the real module`, () => {
      const realSource = readFileSync(resolve(process.cwd(), real), 'utf8')
      const stubSource = readFileSync(resolve(process.cwd(), stub), 'utf8')
      const realNames = extractExportNames(realSource)
      const stubNames = extractExportNames(stubSource)
      const missing = [...realNames].filter((n) => !stubNames.has(n))
      const extra = [...stubNames].filter((n) => !realNames.has(n))
      expect(
        { missing, extra },
        `stub must declare the same export names as the real module\n` +
          `  missing in stub (real exports, stub doesn't): ${missing.join(', ') || '(none)'}\n` +
          `  extra in stub (stub exports, real doesn't): ${extra.join(', ') || '(none)'}`,
      ).toEqual({ missing: [], extra: [] })
    })
  }
})
