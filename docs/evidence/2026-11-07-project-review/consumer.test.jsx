/* eslint-env node */
/* eslint-disable react/prop-types -- Controlled transport components in a dated review fixture. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '../../../src/_locales/resources.mjs'
const state = vi.hoisted(() => ({ config: {}, writes: [], runs: [], reply: '' }))
vi.mock('../../../src/config/storage.mjs', () => ({
  getUserConfig: async () => state.config,
  setUserConfig: async (patch) => {
    state.writes.push(patch)
    state.config = { ...state.config, ...patch }
  },
}))
vi.mock('../../../src/config/language.mjs', async (original) => ({
  ...(await original()),
  getPreferredLanguage: async () => 'Chinese (Simplified)',
}))
vi.mock('../../../src/_locales/i18n-react.mjs', () => ({ i18nReady: Promise.resolve() }))
vi.mock('../../../src/components/ConversationCard', async () => {
  const { useEffect } = await import('preact/hooks')
  return {
    default: ({ question, session, renderAnswer, onUpdate }) => {
      const answer = { type: 'answer', content: state.reply, done: true }
      useEffect(() => {
        state.runs.push(question)
        onUpdate?.({}, session, [answer])
      }, [question])
      return (
        <div data-transport="controlled">
          {renderAnswer ? renderAnswer(answer, 0) : state.reply}
        </div>
      )
    },
  }
})
vi.mock('../../../src/components/ConversationItem', () => ({
  default: ({ content }) => <div>{content}</div>,
}))
import { BrowserAssistant } from '../../../src/browser-assistant/Assistant.jsx'
import { captureContext } from '../../../src/browser-assistant/context.mjs'
let root
const button = (label) =>
  [...root.querySelectorAll('button')].find((x) => x.textContent === i18n.t(label))
const tick = async () => {
  await new Promise((r) => setTimeout(r, 0))
}
async function click(label) {
  await act(async () => {
    const node = button(label)
    if (!node) throw new Error('Missing ' + label + ' in ' + root.textContent)
    node.click()
    await tick()
  })
}
async function mount(context, functionId, autoRun = false) {
  await act(async () => {
    render(
      <BrowserAssistant
        context={context}
        initialConfig={state.config}
        functionId={functionId}
        autoRun={autoRun}
        onClose={() => {}}
      />,
      root,
    )
    await tick()
  })
}
async function edit(field, value) {
  await act(async () => {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  })
}
beforeEach(async () => {
  await i18n
    .use(initReactI18next)
    .init({ resources, lng: 'zh', fallbackLng: 'en', interpolation: { escapeValue: false } })
  state.config = {
    modelName: 'chatgptweb/consumer-model',
    chatgptWebEnabled: true,
    chatgptWebEnabledModels: ['consumer-model'],
    chatgptWebAccountModels: [],
    l1Providers: [],
    activeSelectionTools: [],
    customSelectionTools: [],
    browserAssistantFunctions: [],
  }
  state.writes = []
  state.runs = []
  state.reply = '受控回答'
  document.body.innerHTML =
    '<nav>NOT_ARTICLE</nav><article><p>本周供水量比上周增加百分之十。</p><p>作者据此断言所有居民均已受益。</p></article><textarea id="draft">你好，我想请你明天来开会，谢谢。</textarea><div id="reader"></div>'
  root = document.getElementById('reader')
  root.dataset.chatgptboxAssistant = ''
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => act(() => render(null, root)))
it('reader task: request source marks, then explicitly select result and save reusable practice', async () => {
  const context = captureContext()
  await mount(context)
  expect(state.runs).toHaveLength(0)
  expect(root.querySelector('select').value).toBe('preset.page-overview')
  const instruction = root.querySelector('textarea')
  await edit(instruction, '请标出论证薄弱的原文，并解释原因。')
  console.log(
    'FIRST READING INTENT',
    JSON.stringify({
      instruction: instruction.value,
      summary: root.querySelector('.box-assistant-context').textContent,
      requests: state.runs.length,
    }),
  )
  expect(root.querySelector('.box-assistant-context').textContent).toContain(i18n.t('Answer'))
  await act(async () => {
    const select = root.querySelector('select')
    select.value = 'preset.annotations'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
  })
  expect(root.querySelector('textarea').value).not.toBe('请标出论证薄弱的原文，并解释原因。')
  await edit(
    root.querySelector('textarea'),
    '请检查文章是否把总体供水增加等同于所有居民受益，标出缺少个体证据的原文并解释。',
  )
  state.reply = JSON.stringify({
    guide: '供水总量不能证明每位居民均受益。',
    annotations: [{ ref: 'b2', quote: '所有居民均已受益', reason: '总体变化缺少个体分配依据。' }],
  })
  await click('Run')
  expect(state.runs).toHaveLength(1)
  expect(state.runs[0]).toContain('本周供水量')
  expect(state.runs[0]).not.toContain('NOT_ARTICLE')
  expect(state.runs[0]).not.toContain('你好，我想')
  await click('View source')
  expect(window.getSelection().toString()).toBe('所有居民均已受益')
  await click('Show on page')
  const highlightFallback = root.querySelector('[role="alert"]').textContent
  expect(highlightFallback).toContain(
    i18n.t('This browser does not support page highlights. Use “View source” to select a passage.'),
  )
  await click('Save as function')
  await edit(root.querySelector('.box-assistant-save input'), '找出分配证据')
  await click('Save')
  const saved = state.writes[0].browserAssistantFunctions[0]
  expect(saved.name).toBe('找出分配证据')
  expect(saved.output).toBe('annotations')
  expect(saved.prompt).toContain('个体证据')
  expect(JSON.stringify(saved)).not.toContain('供水量')
  const sourceSelected = window.getSelection().toString()
  act(() => render(null, root))
  document.querySelector('article').innerHTML =
    '<p>新页面报告平均收入上升。</p><p>结论尚未说明低收入群体的变化。</p>'
  await mount(captureContext(), saved.id)
  expect(root.querySelector('select').value).toBe(saved.id)
  expect(root.querySelector('textarea').value).toContain('个体证据')
  expect(root.querySelector('.box-assistant-preview pre').textContent).toContain('新页面报告')
  expect(root.querySelector('.box-assistant-preview pre').textContent).not.toContain('本周供水量')
  expect(state.runs).toHaveLength(1)
  console.log(
    'READING TASK RESULT',
    JSON.stringify({
      sourceSelected,
      highlightFallback,
      saved,
      reopenedOnNewPage: true,
      newMaterialPreview: root.querySelector('.box-assistant-preview pre').textContent,
      remoteCalls: 0,
      controlledRuns: state.runs.length,
    }),
  )
})
it('writer task: rewrite selected draft, explicitly apply and undo, protect later edits', async () => {
  const draft = document.getElementById('draft')
  draft.setSelectionRange(3, 15)
  const context = captureContext({ target: draft })
  await mount(context)
  expect(root.querySelector('select').value).toBe('preset.rewrite')
  expect(state.runs).toHaveLength(0)
  expect(root.querySelector('.box-assistant-preview pre').textContent).toBe(
    context.input.selectedText,
  )
  state.reply = '请明天来参加会议'
  await click('Run')
  expect(state.runs[0]).not.toContain('供水量')
  expect(draft.value).toBe(context.input.text)
  await click('Apply rewrite')
  const applied = draft.value
  expect(applied).toBe(context.input.text.slice(0, 3) + state.reply + context.input.text.slice(15))
  await click('Undo')
  expect(draft.value).toBe(context.input.text)
  await click('Apply rewrite')
  draft.value += '我又补充了新要求。'
  await click('Undo')
  expect(draft.value).toContain('我又补充了新要求。')
  const staleMessage = root.querySelector('[role="alert"]').textContent
  expect(staleMessage).toBe(i18n.t('The input changed. Undo is no longer available.'))
  console.log(
    'WRITING TASK RESULT',
    JSON.stringify({
      original: context.input.text,
      selected: context.input.selectedText,
      applied,
      afterLaterEdit: draft.value,
      staleMessage,
      remoteCalls: 0,
      controlledRuns: state.runs.length,
    }),
  )
})

it('secondary entry: direct named menu action auto-runs without preview/Run click', async () => {
  await mount(captureContext(), 'preset.page-overview', true)
  await act(async () => {
    await tick()
  })
  expect(state.runs).toHaveLength(1)
  expect(root.querySelector('.box-assistant-preview')).toBeNull()
  console.log(
    'DIRECT MENU RESULT',
    JSON.stringify({
      controlledRuns: state.runs.length,
      previewPresent: !!root.querySelector('.box-assistant-preview'),
      runButtonPresent: !!button('Run'),
      remoteCalls: 0,
    }),
  )
})
