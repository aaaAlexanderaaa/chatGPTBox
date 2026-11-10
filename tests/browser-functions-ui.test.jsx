// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '../src/_locales/resources.mjs'

const state = vi.hoisted(() => ({ config: {}, writes: [] }))
vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: async () => state.config,
  setUserConfig: async (patch) => state.writes.push(patch),
}))
vi.mock('../src/config/language.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  getPreferredLanguage: async () => (i18n.language === 'en' ? 'English' : 'Chinese (Simplified)'),
}))
vi.mock('../src/_locales/i18n-react.mjs', () => ({ i18nReady: Promise.resolve() }))
vi.mock('../src/components/ConversationCard', () => ({
  default: ({ question }) => <div data-testid="submitted-prompt">{question}</div>,
}))
vi.mock('../src/components/ConversationItem', () => ({
  default: ({ content }) => <div data-testid="answer">{content}</div>,
}))
import { BrowserAssistant } from '../src/browser-assistant/Assistant.jsx'
import { FunctionLibrary } from '../src/browser-assistant/FunctionLibrary.jsx'
import { GeneralTab } from '../src/popup/components/GeneralTab.jsx'
import { AssistantResult } from '../src/browser-assistant/Result.jsx'
import { captureContext, captureInput } from '../src/browser-assistant/context.mjs'

let root
beforeEach(async () => {
  await i18n
    .use(initReactI18next)
    .init({ resources, lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false } })
  state.config = {
    modelName: 'chatgptweb/model',
    chatgptWebEnabled: true,
    chatgptWebEnabledModels: ['model'],
    chatgptWebAccountModels: [],
    l1Providers: [],
    activeSelectionTools: ['translate'],
    browserAssistantFunctions: [],
    customSelectionTools: [{ name: 'My own name', prompt: 'My own instruction', active: true }],
  }
  state.writes = []
  document.body.innerHTML =
    '<article><p>Source material.</p></article><textarea>Original draft</textarea><div id="root"></div>'
  root = document.getElementById('root')
})
afterEach(() => act(() => render(null, root)))
const button = (name) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent === name)

describe('function UI across languages and model formats', () => {
  it('edits beside the chosen function, preserves text through template toggles and keeps failed drafts', async () => {
    const updateConfig = vi
      .fn()
      .mockRejectedValueOnce(new Error('Storage full'))
      .mockResolvedValueOnce(undefined)
    act(() => render(<FunctionLibrary config={state.config} updateConfig={updateConfig} />, root))
    const row = root.querySelector('[data-function-id="legacy.0"]')
    const edit = [...row.querySelectorAll('button')].find((item) => item.textContent === 'Edit')
    act(() => {
      edit.focus()
      edit.click()
    })
    const form = row.querySelector('form')
    expect(form).toBeTruthy()
    expect(document.activeElement).toBe(form.querySelector('input'))
    act(() => {
      const input = form.querySelector('textarea')
      input.value = '请按照我的要求编辑草稿。'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      form.querySelector('[aria-label="Use prompt template"]').click()
    })
    expect(form.querySelector('textarea').value).toBe('请按照我的要求编辑草稿。')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(form.querySelector('[role="alert"]').textContent).toBe('Storage full')
    expect(form.querySelector('textarea').value).toBe('请按照我的要求编辑草稿。')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(row.querySelector('form')).toBeNull()
    expect(document.activeElement).toBe(edit)
  })

  it('searches saved and disabled functions and explains an empty result', () => {
    act(() => render(<FunctionLibrary config={state.config} updateConfig={async () => {}} />, root))
    act(() => {
      const search = root.querySelector('input[type="search"]')
      search.value = 'My own name'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(root.querySelectorAll('[data-function-id]')).toHaveLength(1)
    act(() => {
      const search = root.querySelector('input[type="search"]')
      search.value = 'no-such-function'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(root.textContent).toContain('No matching functions.')
  })

  it('submits the selected input for a content template instead of reading the page body', async () => {
    const context = captureContext()
    context.input = captureInput(document.querySelector('textarea'))
    state.config.browserAssistantFunctions = [
      {
        id: 'draft-template',
        name: 'Draft template',
        scope: 'input',
        output: 'chat',
        prompt: 'Rewrite {{content}}',
        template: true,
      },
    ]
    await act(async () => {
      render(
        <BrowserAssistant
          context={context}
          initialConfig={state.config}
          functionId="draft-template"
          onClose={() => {}}
        />,
        root,
      )
    })
    expect(document.activeElement).toBe(root.querySelector('textarea'))
    expect(root.querySelector('[data-testid="submitted-prompt"]')).toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      button('Run').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const prompt = root.querySelector('[data-testid="submitted-prompt"]').textContent
    expect(document.activeElement).toBe(root.querySelector('[role="dialog"]'))
    expect(prompt).toContain('Rewrite Original draft')
    expect(prompt).not.toContain('Source material.')
  })

  it('closes with Escape while preserving IME composition', () => {
    const onClose = vi.fn()
    act(() =>
      render(
        <BrowserAssistant
          context={captureContext()}
          initialConfig={state.config}
          onClose={onClose}
        />,
        root,
      ),
    )
    const textarea = root.querySelector('textarea')
    act(() =>
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
      ),
    )
    expect(onClose).not.toHaveBeenCalled()
    act(() =>
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('localizes General labels and Auto without leaving English setting descriptions', async () => {
    await i18n.changeLanguage('zh')
    act(() =>
      render(
        <GeneralTab
          config={{ ...state.config, triggerMode: 'manually', preferredLanguage: 'auto' }}
          updateConfig={async () => {}}
        />,
        root,
      ),
    )
    expect(root.textContent).toContain('常规选项')
    expect(root.textContent).toContain('触发方式')
    expect(root.textContent).toContain('自动')
    expect(root.textContent).not.toMatch(
      /BASICS|Trigger Mode|Used for prompts and UI|Default action/,
    )
  })
  it('updates untouched built-in instructions after asynchronous language changes without overwriting edits', async () => {
    act(() =>
      render(
        <BrowserAssistant
          context={captureContext()}
          initialConfig={state.config}
          functionId="preset.annotations"
          onClose={() => {}}
        />,
        root,
      ),
    )
    expect(root.querySelector('textarea').value).toContain('Give a short reading guide')
    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expect(root.querySelector('textarea').value).toContain('给出简短导读')
    act(() => {
      const field = root.querySelector('textarea')
      field.value = '请按我自己的要求处理。'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(root.querySelector('textarea').value).toBe('请按我自己的要求处理。')
  })
  it.each(['en', 'zh', 'zhHant'])(
    'shows one function library in %s and preserves user-authored names',
    async (language) => {
      await i18n.changeLanguage(language)
      act(() =>
        render(<FunctionLibrary config={state.config} updateConfig={async () => {}} />, root),
      )
      expect(root.textContent).toContain(i18n.t('Functions'))
      expect(root.textContent).toContain(i18n.t('Read and annotate'))
      expect(root.textContent).toContain('My own name')
      expect(root.textContent).not.toMatch(/Built-in Tools|Custom Tools|Browser assistant/)
      expect(root.textContent).not.toContain('browserAssistantFunctions')
      expect(root.textContent).toContain(i18n.t('Context menu'))
    },
  )
  it('submits the selected catalog function once with the current language and no unresolved template', async () => {
    await i18n.changeLanguage('zh')
    await act(async () => {
      render(
        <BrowserAssistant
          context={captureContext({ selection: 'A sample sentence' })}
          initialConfig={state.config}
          functionId="builtin.translate"
          autoRun={true}
          onClose={() => {}}
        />,
        root,
      )
      await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const submitted = root.querySelector('[data-testid="submitted-prompt"]')
    if (!submitted) throw new Error(root.textContent)
    const prompt = submitted.textContent
    expect(prompt).toContain('Chinese (Simplified)')
    expect(prompt).toContain('A sample sentence')
    expect(prompt).not.toContain('{{language}}')
  })
  it('applies only the final rewrite, keeping model reasoning out of the input', () => {
    const field = document.querySelector('textarea')
    const input = captureInput(field)
    act(() =>
      render(
        <AssistantResult
          run={{ fn: { output: 'replacement' }, material: input.text, context: { input } }}
          text={'<think>Editing rationale</think>\n```text\nBetter draft\n```'}
        />,
        root,
      ),
    )
    act(() => button('Apply rewrite').click())
    expect(field.value).toBe('Better draft')
    expect(root.querySelector('details').textContent).toContain('Editing rationale')
  })
  it('keeps an ordinary answer readable when annotations cannot be extracted', async () => {
    await i18n.changeLanguage('zh')
    act(() =>
      render(
        <AssistantResult
          run={{ fn: { output: 'annotations' } }}
          text="<think>Reviewing the source.</think>普通文字回答，没有 JSON。"
        />,
        root,
      ),
    )
    expect(root.textContent).toContain('普通文字回答，没有 JSON。')
    expect(root.textContent).not.toContain('Unexpected token')
    expect(root.textContent).not.toContain('not a valid reading guide')
  })
})
