/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Webpack entries that `dependOn: 'shared'` are chunk-only files: they push
// onto webpackChunkchatgptbox and never boot unless the page loads shared.js
// first. popup / options / IndependentPanel / ApiServer already do this;
// a missing tag on a new entry is a blank page (review P0 on dsh.html).
// Resolve from this file so a worktree test never reads the main checkout
// when vitest's cwd is the other tree.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

function stylesheetHrefs(html) {
  return [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((match) => match[1])
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

const SHARED_CSS_HTML = [
  'src/popup/index.html',
  'src/options/index.html',
  'src/pages/IndependentPanel/index.html',
]

describe('pages that render shared Markdown/KaTeX', () => {
  it.each(SHARED_CSS_HTML)('%s loads shared.css before content-script.css', (relative) => {
    const html = readFileSync(path.join(root, relative), 'utf8')
    const hrefs = stylesheetHrefs(html)
    expect(hrefs).toContain('shared.css')
    expect(hrefs).toContain('content-script.css')
    expect(hrefs.indexOf('shared.css')).toBeLessThan(hrefs.indexOf('content-script.css'))
  })
})

describe('DSH packaged stylesheet name', () => {
  it('copies webpack dsh.css to the href used by dsh.html', () => {
    const html = readFileSync(path.join(root, 'src/modules/dsh/ui/index.html'), 'utf8')
    const hrefs = stylesheetHrefs(html)
    expect(hrefs).toHaveLength(1)
    const packagedName = hrefs[0]
    const build = readFileSync(path.join(root, 'build.mjs'), 'utf8')
    expect(build).toMatch(
      new RegExp(`src:\\s*'build/dsh\\.css',\\s*dst:\\s*'${packagedName.replaceAll('.', '\\.')}'`),
    )
  })
})
