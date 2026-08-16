/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Webpack entries that `dependOn: 'shared'` are chunk-only files: they push
// onto webpackChunkchatgptbox and never boot unless the page loads shared.js
// first. popup / options / IndependentPanel / ApiServer already do this;
// a missing tag on a new entry is a blank page (review P0 on dsh.html).

const root = path.resolve(process.cwd())

const SHARED_DEPENDENT_HTML = [
  ['src/popup/index.html', 'popup.js'],
  ['src/options/index.html', 'options.js'],
  ['src/pages/IndependentPanel/index.html', 'IndependentPanel.js'],
  ['src/pages/ApiServer/index.html', 'ApiServer.js'],
  ['src/modules/dsh/ui/index.html', 'dsh.js'],
]

function scriptSrcs(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1])
}

describe('UI entries that depend on the shared webpack chunk', () => {
  it.each(SHARED_DEPENDENT_HTML)('%s loads shared.js before %s', (relative, entry) => {
    const html = readFileSync(path.join(root, relative), 'utf8')
    const srcs = scriptSrcs(html)
    expect(srcs).toContain('shared.js')
    expect(srcs).toContain(entry)
    expect(srcs.indexOf('shared.js')).toBeLessThan(srcs.indexOf(entry))
  })
})
