/* eslint-env node */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tokenizer } from 'acorn'
import webpack from 'webpack'
import TerserPlugin from 'terser-webpack-plugin'

const root = fileURLToPath(new URL('../', import.meta.url))
const stylesheet = new URL('../src/components/MarkdownRender/genui.css', import.meta.url)
const sourceTemplate = new URL('../docs/drafts/chatgptbox-preview.source.html', import.meta.url)
const template = new URL('../docs/drafts/chatgptbox-preview.html', import.meta.url)
const actionFile = new URL('../docs/drafts/chatgptbox-preview.draftsAction', import.meta.url)

// Stable public package identities, created for this action (not account IDs).
export function createDraftsPreviewAction(html) {
  return {
    uuid: '89E9B0C5-1DDC-4E61-A541-BF2C2B0E8D2D',
    name: 'ChatGPTBox Preview',
    shortName: 'Preview',
    actionDescription: 'Offline ChatGPTBox conversation preview with local interactive charts.',
    steps: [
      {
        uuid: '49892222-6483-4DC2-927B-51AB0A3EF399',
        type: 'htmlpreview',
        platforms: 3,
        isEnabled: true,
        data: { template: html, templateType: 'legacy', hideInterface: 'false' },
      },
    ],
    shouldConfirm: false,
    disposition: 0,
    groupDisposition: 0,
    logLevel: 1,
    notificationType: 1,
    tintColor: 'gray',
    keyUseIcon: true,
    icon: 'eye',
    visibility: 480,
    assignTags: [],
  }
}

// Drafts scans [[tags]] and %%Markdown%% even inside script elements. Preserve
// JavaScript semantics while making those delimiters impossible in the bundle.
export function protectDraftsScript(source) {
  const changes = []
  let previous
  for (const token of tokenizer(source, { ecmaVersion: 'latest' })) {
    const raw = source.slice(token.start, token.end)
    if (['string', 'template'].includes(token.type.label)) {
      const literal = token.type.label === 'string' ? JSON.stringify(token.value) : raw
      const replacement = literal
        .replace(/\[/g, '\\x5b')
        .replace(/%/g, '\\x25')
        .replace(/</g, '\\x3c')
      if (replacement !== raw) changes.push([token.start, token.end, replacement])
    } else if (
      ['[', '{'].includes(token.type.label) &&
      previous?.type.label === token.type.label &&
      previous.end === token.start
    )
      changes.push([token.start, token.start, ' '])
    previous = token
  }
  for (const [start, end, replacement] of changes.reverse())
    source = source.slice(0, start) + replacement + source.slice(end)
  if (/\[\[|\{\{|%%|<\/script/i.test(source))
    throw new Error('Preview runtime contains a Drafts template delimiter')
  return source
}

async function bundleRuntime() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-preview-'))
  try {
    await new Promise((resolve, reject) => {
      const compiler = webpack({
        context: root,
        mode: 'production',
        target: ['web', 'es2020'],
        devtool: false,
        entry: './src/components/MarkdownRender/drafts-preview-runtime.mjs',
        output: { path: directory, filename: 'preview.js', iife: true },
        optimization: {
          minimizer: [
            new TerserPlugin({
              extractComments: false,
              terserOptions: { format: { ascii_only: true, comments: false } },
            }),
          ],
        },
      })
      compiler.run((error, stats) =>
        compiler.close((closeError) => {
          if (error || closeError || stats?.hasErrors())
            reject(error || closeError || new Error(stats.toString({ all: false, errors: true })))
          else resolve()
        }),
      )
    })
    const licenses = ['echarts/NOTICE', 'echarts/LICENSE', 'zrender/LICENSE', 'tslib/LICENSE.txt']
      .map((name) =>
        fs.readFileSync(path.join(root, 'node_modules', name), 'utf8').replace(/\r\n?/g, '\n'),
      )
      .join('\n\n')
    return `/* Bundled third-party notices and licenses\n${licenses.replace(
      /\*\//g,
      '* /',
    )}\n*/\n${protectDraftsScript(fs.readFileSync(path.join(directory, 'preview.js'), 'utf8'))}`
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

export async function syncDraftsPreview({ check = false } = {}) {
  let source = fs.readFileSync(sourceTemplate, 'utf8')
  const begin = '/* chatgptbox-genui-styles:start */',
    end = '/* chatgptbox-genui-styles:end */'
  const start = source.indexOf(begin),
    finish = source.indexOf(end)
  if (
    start < 0 ||
    finish < start ||
    source.indexOf(begin, start + begin.length) >= 0 ||
    source.indexOf(end, finish + end.length) >= 0
  )
    throw new Error('Drafts preview style markers are missing or duplicated')
  source =
    source.slice(0, start + begin.length) +
    '\n' +
    fs.readFileSync(stylesheet, 'utf8').trim() +
    '\n      ' +
    source.slice(finish)
  const script = await bundleRuntime()
  const hash = createHash('sha256').update(script).digest('base64')
  source = source.replace("default-src 'none';", `default-src 'none'; script-src 'sha256-${hash}';`)
  source = source.replace('</body>', () => `<script>${script}</script>\n  </body>`)
  const action = JSON.stringify(createDraftsPreviewAction(source), null, 2) + '\n'
  if (
    fs.existsSync(template) &&
    fs.readFileSync(template, 'utf8') === source &&
    fs.existsSync(actionFile) &&
    fs.readFileSync(actionFile, 'utf8') === action
  )
    return false
  if (check) throw new Error('Drafts preview is stale; run npm run sync-drafts-preview')
  fs.writeFileSync(template, source)
  fs.writeFileSync(actionFile, action)
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await syncDraftsPreview({ check: process.argv.includes('--check') })
