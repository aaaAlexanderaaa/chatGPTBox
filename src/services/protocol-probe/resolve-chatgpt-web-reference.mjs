// Node-only. Reads resources/chatgpt-web/current and maps each file to a
// role with the same markers the live probe uses. Do not import this from
// extension pages — they load the generated chatgpt-web-current.mjs instead.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyFetchedScripts } from './evaluate.mjs'

export const CHATGPT_WEB_CURRENT_DIR = 'resources/chatgpt-web/current'
export const CHATGPT_WEB_ARCHIVE_DIR = 'resources/chatgpt-web/archive'

export function resolveChatgptWebCurrentReference({ repoRoot, spec } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required')
  if (!spec?.roles?.length) throw new Error('spec.roles is required')

  const dir = join(repoRoot, CHATGPT_WEB_CURRENT_DIR)
  let names = []
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.js') && !name.startsWith('.'))
  } catch (error) {
    throw new Error(`Cannot read ${CHATGPT_WEB_CURRENT_DIR}: ${error.message}`)
  }
  if (names.length === 0) {
    throw new Error(`No .js files in ${CHATGPT_WEB_CURRENT_DIR}`)
  }

  const fetched = names.map((filename) => ({
    filename,
    url: filename,
    text: readFileSync(join(dir, filename), 'utf8'),
  }))
  const roles = classifyFetchedScripts(spec, fetched)
  const files = []
  const assigned = new Set()

  for (const role of spec.roles) {
    const entry = roles[role.id]
    if (!entry?.filename) {
      throw new Error(
        `No file in ${CHATGPT_WEB_CURRENT_DIR} identified as ${role.id}. ` +
          `Drop the live bundle there, or archive extras that are not this role.`,
      )
    }
    if (assigned.has(entry.filename)) {
      throw new Error(`${entry.filename} matched more than one role; tighten identifyAll markers.`)
    }
    assigned.add(entry.filename)
    files.push({ filename: entry.filename, roleId: role.id })
  }

  const extra = names.filter((name) => !assigned.has(name))
  if (extra.length) {
    throw new Error(
      `Unidentified files in ${CHATGPT_WEB_CURRENT_DIR}: ${extra.join(', ')}. ` +
        `Move old bundles to ${CHATGPT_WEB_ARCHIVE_DIR}.`,
    )
  }

  return { dir: CHATGPT_WEB_CURRENT_DIR, files }
}
