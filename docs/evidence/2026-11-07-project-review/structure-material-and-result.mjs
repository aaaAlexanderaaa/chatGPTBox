/* eslint-env node */
// Dated second-pass witness; assertions describe the reviewed baseline.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import vm from 'node:vm'

// Disposable, read-only local probe. No browser, HTTP client, model call,
// extension background, or DSH gateway is started.
const repository = path.resolve(
  process.argv[2] || fileURLToPath(new URL('../../../', import.meta.url)),
)
const requireFromRepository = createRequire(path.join(repository, 'package.json'))
const { JSDOM } = await import(pathToFileURL(requireFromRepository.resolve('jsdom')).href)
const { parse } = await import(pathToFileURL(requireFromRepository.resolve('acorn')).href)
const importRepository = (file) => import(pathToFileURL(path.join(repository, file)).href)
const { captureContext, captureReadingSnapshot } = await importRepository(
  'src/browser-assistant/context.mjs',
)
const { createFunction, functionWithRefinements, prepareFunctionRun } = await importRepository(
  'src/browser-assistant/functions.mjs',
)
const { normalizeModelAnswer, unwrapAnswerFence } = await importRepository(
  'src/services/model-answer.mjs',
)

const dom = new JSDOM(
  '<article><p>Overview teaser.</p></article><main><p>Actual discussion with the decision.</p><article><p>Critical response.</p></article></main>',
  { url: 'https://example.test/discussion', pretendToBeVisual: true },
)
const context = captureContext({ doc: dom.window.document })
const snapshot = captureReadingSnapshot(context)
const fn = createFunction({ scope: 'page', output: 'chat', prompt: 'Give a quick overview.' })
const changed = functionWithRefinements(fn, [
  'Mark the important original passages and explain why.',
])
const run = prepareFunctionRun({
  fn: changed,
  config: {
    modelName: 'test/text',
    l1Providers: [{ id: 'test', models: [{ id: 'text', enabled: true }] }],
  },
  context,
  snapshot,
})
const materialAndRefinement = {
  inputHtml: dom.window.document.body.innerHTML,
  originalFunction: { scope: fn.scope, output: fn.output, prompt: fn.prompt },
  refinement: 'Mark the important original passages and explain why.',
  material: run.material,
  truncated: snapshot.truncated,
  functionOutputAfterRefinement: changed.output,
  structuredAnnotationInstructions: run.prompt.includes('Return only JSON with this shape'),
}
assert.equal(materialAndRefinement.material, '[b1] Overview teaser.')
assert.equal(materialAndRefinement.truncated, false)
assert.equal(materialAndRefinement.functionOutputAfterRefinement, 'chat')
assert.equal(materialAndRefinement.structuredAnnotationInstructions, false)
dom.window.close()

// Extract the exact pure renderer and its two local dependencies by AST range.
// This avoids evaluating imports that bootstrap extension services.
const dshFile = path.join(repository, 'src/background/providers/dsh-bridge.mjs')
const dshSource = await readFile(dshFile, 'utf8')
const dshAst = parse(dshSource, { ecmaVersion: 'latest', sourceType: 'module' })
const wantedNames = new Set(['TOOL_ARGS_PREVIEW_CHARS', 'previewToolArgs', 'renderLedgerMarkdown'])
const fragments = []
const extractedNames = []
for (const item of dshAst.body) {
  const declaration = item.type === 'ExportNamedDeclaration' ? item.declaration : item
  if (!declaration) continue
  const name =
    declaration.type === 'VariableDeclaration'
      ? declaration.declarations.length === 1 && declaration.declarations[0].id.name
      : declaration.type === 'FunctionDeclaration' && declaration.id.name
  if (!wantedNames.has(name)) continue
  fragments.push(dshSource.slice(declaration.start, declaration.end))
  extractedNames.push(name)
}
assert.deepEqual(extractedNames, [...wantedNames])
const { renderLedgerMarkdown } = vm.runInNewContext(
  fragments.join('\n\n') + '\n;({ renderLedgerMarkdown })',
  Object.create(null),
  { timeout: 1000, filename: dshFile + ':pure-renderer-extract' },
)
const finalText = 'Rewritten draft.'
const cases = [
  {
    name: 'text-and-turn-end-without-tools',
    blocks: [
      { kind: 'text', text: finalText },
      { kind: 'turn-end', note: 'completed' },
    ],
  },
  {
    name: 'tool-text-and-turn-end',
    blocks: [
      { kind: 'tool', name: 'shell', args: 'printf example', status: 'done' },
      { kind: 'text', text: finalText },
      { kind: 'turn-end', note: 'completed' },
    ],
  },
]
const dshReplacement = cases.map(({ name, blocks }) => {
  const answer = renderLedgerMarkdown(blocks)
  const normalized = normalizeModelAnswer(answer)
  // Exact computation used by AssistantResult's rewrite branch.
  const replacement = unwrapAnswerFence(normalized.text)
  assert.notEqual(replacement, finalText)
  assert.equal(normalized.pending, false)
  assert.equal(normalized.reasoning, '')
  assert.ok(replacement.includes('*— completed —*'))
  return { name, blocks, expectedModelFinalText: finalText, answer, normalized, replacement }
})
assert.ok(dshReplacement[1].replacement.includes('🔧 shell printf example'))

const relevantFiles = [
  'src/browser-assistant/context.mjs',
  'src/browser-assistant/functions.mjs',
  'src/background/providers/dsh-bridge.mjs',
  'src/services/model-answer.mjs',
  'src/browser-assistant/Result.jsx',
]
const sourceSha256 = {}
for (const file of relevantFiles) {
  sourceSha256[file] = createHash('sha256')
    .update(await readFile(path.join(repository, file)))
    .digest('hex')
}
console.log(
  JSON.stringify(
    {
      repository,
      nodeVersion: process.version,
      method:
        'Local JSDOM and actual imported pure functions; DSH renderer extracted unchanged by AST source ranges and executed in an isolated VM.',
      extractedDshDeclarations: extractedNames,
      sourceSha256,
      materialAndRefinement,
      dshReplacement,
      assertions: 'passed',
    },
    null,
    2,
  ),
)
