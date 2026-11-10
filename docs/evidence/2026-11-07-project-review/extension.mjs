/* eslint-env node */
// Dated synthetic defect witness. A fix can make these baseline assertions fail.
import { fileURLToPath } from 'node:url'
// Read-only review probes for ChatGPTBox, 2026-11-07 (America/Los_Angeles).
// Uses only synthetic local DOM/text; never invokes an engine or account.
// Run from the repository root as documented in the adjacent review.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const require = createRequire(`${projectRoot}/package.json`)
const { JSDOM } = require('jsdom')
const { createFunction, validateFunction, importFunctions, exportFunctions, prepareFunctionRun } =
  await import(`${projectRoot}/src/browser-assistant/functions.mjs`)
const { resolvePromptTemplate } = await import(
  `${projectRoot}/src/utils/prompt-template-context.mjs`
)
const { installNativePaste } = await import(
  `${projectRoot}/src/native-chatgpt/paste-controller.mjs`
)
const { installNativeDraftEntry } = await import(
  `${projectRoot}/src/native-chatgpt/draft-entry.mjs`
)
const config = {
  modelName: 'chatgptweb/review-fixture',
  chatgptWebEnabled: true,
  chatgptWebEnabledModels: ['review-fixture'],
  chatgptWebAccountModels: [],
  l1Providers: [],
}
function prepare(fn, context) {
  return prepareFunctionRun({
    fn,
    context,
    config,
    resolveTemplate: (template, material) =>
      resolvePromptTemplate(template, {
        selection: material,
        customExtractors: [],
        allowFullHtml: false,
        pageContext: {
          title: context.title,
          url: context.url,
          language: 'English',
          content: material,
        },
      }),
  })
}
const outputs = { node: process.version, scope: [], truncation: [], spa: [] }
{
  const dom = new JSDOM(
    '<body><main><p>Public article</p></main><aside hidden>UNSELECTED-PRIVATE-SIDEBAR</aside><input type="password" value="FORM-PASSWORD-PRIVATE"></body>',
    { url: 'https://example.org/' },
  )
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  for (const variable of ['domTree', 'interactiveElements']) {
    const created = createFunction({
      name: `Legal ${variable} function`,
      scope: 'url',
      template: true,
      prompt: `Summarize {{${variable}}}`,
    })
    // Exercises production validation and the portable JSON import/export path.
    const fn = importFunctions(exportFunctions([created]))[0]
    assert.deepEqual(validateFunction(fn), fn)
    const run = prepare(fn, { url: dom.window.location.href, title: 'Article' })
    assert.equal(run.material, 'https://example.org/')
    const observation = {
      variable,
      passedProductionValidationAndImport: true,
      scope: fn.scope,
      materialPreview: run.material,
      hiddenPageTextInRequest: run.prompt.includes('UNSELECTED-PRIVATE-SIDEBAR'),
      passwordValueAttributeInRequest: run.prompt.includes('FORM-PASSWORD-PRIVATE'),
    }
    if (variable === 'domTree') assert.equal(observation.hiddenPageTextInRequest, true)
    else assert.equal(observation.passwordValueAttributeInRequest, true)
    outputs.scope.push(observation)
  }
  dom.window.close()
  delete globalThis.window
  delete globalThis.document
}
{
  const text = 'A'.repeat(19000) + ' END-CRITICAL-CONCLUSION'
  for (const variable of ['selection', 'content']) {
    const fn = createFunction({
      scope: 'input',
      output: 'replacement',
      template: true,
      prompt: `Rewrite {{${variable}}}`,
    })
    const run = prepare(fn, { url: 'https://example.org/', title: 'Draft', input: { text } })
    const observation = {
      variable,
      originalAndMaterialPreviewChars: run.material.length,
      finalRequestChars: run.prompt.length,
      previewHasTail: run.material.includes('END-CRITICAL-CONCLUSION'),
      finalRequestHasTail: run.prompt.includes('END-CRITICAL-CONCLUSION'),
      finalRequestHasTruncationMarker: run.prompt.includes('[truncated]'),
      materialPreviewHasTruncationMarker: run.material.includes('[truncated]'),
    }
    assert.equal(observation.previewHasTail, true)
    assert.equal(observation.finalRequestHasTail, false)
    assert.equal(observation.finalRequestHasTruncationMarker, true)
    assert.equal(observation.materialPreviewHasTruncationMarker, false)
    outputs.truncation.push(observation)
  }
}
{
  const eventSlot = () => ({ addListener() {}, removeListener() {} })
  for (const initialPath of ['/', '/g/review-fixture']) {
    const dom = new JSDOM(
      '<body><form><div id="prompt-textarea" contenteditable="true"><p>Draft</p></div></form></body>',
      {
        url: 'https://chatgpt.com' + initialPath,
        pretendToBeVisual: true,
      },
    )
    const doc = dom.window.document
    let pasteListeners = 0
    const add = dom.window.addEventListener.bind(dom.window)
    dom.window.addEventListener = (type, ...args) => {
      if (type === 'paste') pasteListeners++
      return add(type, ...args)
    }
    const controller = installNativePaste({
      doc,
      browser: { runtime: { id: 'review-test', onConnect: eventSlot(), onMessage: eventSlot() } },
    })
    controller.configure({ chatgptNativePasteEnabled: true })
    const stopDraft = installNativeDraftEntry({ doc, enabled: true, t: (x) => x, onRewrite() {} })
    dom.window.history.pushState({}, '', '/')
    doc.body.append(doc.createElement('span'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    const observation = {
      initialPath,
      finalPath: doc.location.pathname,
      registeredPasteListeners: pasteListeners,
      rewriteEntry: !!doc.querySelector('[data-chatgptbox-native-draft]'),
      pasteStatus: !!doc.querySelector('[data-chatgptbox-native-paste]'),
    }
    assert.equal(observation.registeredPasteListeners, initialPath === '/' ? 1 : 0)
    assert.equal(observation.rewriteEntry, initialPath === '/')
    outputs.spa.push(observation)
    controller.dispose()
    stopDraft()
    dom.window.close()
  }
}
console.log(JSON.stringify(outputs, null, 2))
