// @vitest-environment jsdom
/* eslint-disable react/prop-types -- Controlled transport components in a dated review fixture. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '../src/_locales/resources.mjs'
const state = vi.hoisted(() => ({
  config: {},
  writes: [],
  runs: [],
  reply: '',
  outcome: 'completed',
  refinements: [],
}))
vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: async () => state.config,
  setUserConfig: async (patch) => {
    state.writes.push(patch)
    state.config = { ...state.config, ...patch }
  },
}))
vi.mock('../src/config/language.mjs', async (original) => ({
  ...(await original()),
  getPreferredLanguage: async () => 'Chinese (Simplified)',
}))
vi.mock('../src/_locales/i18n-react.mjs', () => ({ i18nReady: Promise.resolve() }))
vi.mock('../src/components/ConversationCard', async () => {
  const { useEffect } = await import('preact/hooks')
  return {
    default: ({ question, session, renderAnswer, onUpdate }) => {
      const answer = { type: 'answer', content: state.reply, done: true, outcome: state.outcome }
      useEffect(() => {
        state.runs.push(question)
        onUpdate?.({}, session, [
          ...state.refinements.map((content) => ({ type: 'question', content })),
          answer,
        ])
      }, [question])
      return (
        <div data-transport="controlled">
          {renderAnswer ? renderAnswer(answer, 0) : state.reply}
        </div>
      )
    },
  }
})
vi.mock('../src/components/ConversationItem', () => ({
  default: ({ content }) => <div>{content}</div>,
}))
import { BrowserAssistant } from '../src/browser-assistant/Assistant.jsx'
import { captureContext } from '../src/browser-assistant/context.mjs'
let root
const button = (label) =>
  [...root.querySelectorAll('button')].find((x) => x.textContent === i18n.t(label))
const tick = async () => {
  await new Promise((r) => setTimeout(r, 0))
}
async function click(label) {
  await act(tick)
  await act(async () => {
    const node = button(label)
    if (!node) throw new Error('Missing ' + label + ' in ' + root.textContent)
    node.click()
    await tick()
  })
  await act(tick)
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
  await act(tick)
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
  state.outcome = 'completed'
  state.refinements = []
  document.body.innerHTML =
    '<nav>NOT_ARTICLE</nav><article><p>本周供水量比上周增加百分之十。</p><p>作者据此断言所有居民均已受益。</p></article><textarea id="draft">你好，我想请你明天来开会，谢谢。</textarea><div id="reader"></div>'
  root = document.getElementById('reader')
  root.dataset.chatgptboxAssistant = ''
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => act(() => render(null, root)))

it('freezes extra template context, blocks autoRun until disclosure, and preserves 19k selected material', async () => {
  const material = 'a'.repeat(19000) + 'END_OF_SELECTION'
  const fn = {
    id: 'extra',
    name: 'extra',
    prompt: '{{selection}} {{headings}} {{interactiveElements}}',
    scope: 'selection',
    output: 'chat',
    template: true,
  }
  state.config.browserAssistantFunctions = [fn]
  document
    .querySelector('article')
    .insertAdjacentHTML(
      'beforeend',
      '<h2>PREVIEW_HEADING</h2><input type="password" value="PASSWORD_SENTINEL">',
    )
  const context = captureContext({ selection: material })
  await mount(context, fn.id, true)
  await act(tick)
  expect(state.runs).toEqual([])
  expect(button('Run').disabled).toBe(true)
  expect(root.textContent).toContain('PREVIEW_HEADING')
  expect(root.textContent).not.toContain('PASSWORD_SENTINEL')
  document.querySelector('h2').textContent = 'LATER_HEADING'
  await act(async () => {
    root.querySelector('input[type="checkbox"]').click()
    await tick()
  })
  await click('Run')
  expect(state.runs).toHaveLength(1)
  expect(state.runs[0]).toContain('END_OF_SELECTION')
  expect(state.runs[0]).toContain('PREVIEW_HEADING')
  expect(state.runs[0]).not.toContain('LATER_HEADING')
})
it('keeps page-variable material and consent stable while editing an instruction', async () => {
  state.config.browserAssistantFunctions = [
    {
      id: 'page-variables',
      name: 'Page variables',
      prompt: '{{headings}} {{links}} {{interactiveElements}}',
      scope: 'selection',
      output: 'chat',
      template: true,
    },
  ]
  document.querySelector('article').insertAdjacentHTML('beforeend', '<h2>ORIGINAL_HEADING</h2>')
  await mount(captureContext({ selection: 'Selected material' }), 'page-variables')
  await act(async () => {
    root.querySelector('input[type="checkbox"]').click()
    document.querySelector('article h2').textContent = 'LATER_HEADING'
    const instruction = root.querySelector('textarea')
    instruction.value += '\nUse short sentences.'
    instruction.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  })
  await act(tick)
  expect(root.querySelector('input[type="checkbox"]').checked).toBe(true)
  await click('Run')
  expect(state.runs[0]).toContain('ORIGINAL_HEADING')
  expect(state.runs[0]).not.toContain('LATER_HEADING')
  expect(state.runs[0]).not.toContain('Manage functions')
  expect(state.runs[0]).not.toContain('options.html')
})

it('previews the current input before another rewrite and can apply it without reopening', async () => {
  const draft = document.getElementById('draft')
  await mount(captureContext({ target: draft }))
  state.reply = 'First rewrite'
  await click('Run')
  await click('Apply rewrite')
  expect(draft.value).toBe('First rewrite')
  await click('Change instruction')
  expect(root.querySelector('.box-assistant-preview pre').textContent).toBe('First rewrite')
  state.reply = 'Second rewrite'
  await click('Run')
  expect(state.runs[1]).toContain('First rewrite')
  await click('Apply rewrite')
  expect(draft.value).toBe('Second rewrite')
  expect(root.querySelector('[role="alert"]')).toBeNull()
})
it('changes overview to annotations with the same source and refinements, then saves the changed practice', async () => {
  state.refinements = ['只看个体分配依据']
  await mount(captureContext())
  await click('Run')
  document.querySelector('article').insertAdjacentHTML('beforeend', '<p>LATER_MATERIAL</p>')
  await act(async () => {
    const select = root.querySelector('.box-assistant-run-summary select')
    select.value = 'annotations'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
  })
  expect(root.querySelector('textarea').value).toContain('只看个体分配依据')
  expect(root.querySelector('.box-assistant-preview pre').textContent).not.toContain(
    'LATER_MATERIAL',
  )
  state.reply = JSON.stringify({
    guide: '检查分配证据',
    annotations: [{ ref: 'b2', quote: '所有居民均已受益', reason: '尚无个体证据' }],
  })
  state.refinements = []
  await click('Run')
  expect(state.runs[1]).toContain('只看个体分配依据')
  expect(state.runs[1]).not.toContain('LATER_MATERIAL')
  await click('View source')
  expect(window.getSelection().toString()).toBe('所有居民均已受益')
  await click('Save as function')
  await click('Save')
  const saved = state.writes[0].browserAssistantFunctions[0]
  expect(saved.output).toBe('annotations')
  expect(saved.prompt).toContain('只看个体分配依据')
  expect(JSON.stringify(saved)).not.toContain('供水量')
  act(() => render(null, root))
  document.querySelector('article').innerHTML = '<p>另一讨论的新材料。</p>'
  await mount(captureContext(), saved.id)
  expect(root.querySelector('.box-assistant-preview pre').textContent).toContain('另一讨论')
  expect(state.runs).toHaveLength(2)
})
it.each(['stopped', 'incomplete', 'failed'])(
  'keeps %s rewrite visible without an Apply action',
  async (outcome) => {
    state.outcome = outcome
    state.reply = '尚未完整的建议文本'
    const draft = document.getElementById('draft'),
      original = draft.value
    await mount(captureContext({ target: draft }))
    await click('Run')
    expect(root.textContent).toContain(state.reply)
    expect(button('Apply rewrite')).toBeUndefined()
    expect(draft.value).toBe(original)
  },
)
