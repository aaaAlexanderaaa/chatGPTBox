import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { nativeChatgptConfig } from '../src/config/native-chatgpt.mjs'
import {
  isNativeChatgptUrl,
  nativeChatgptEditor,
  editorText,
} from '../src/native-chatgpt/editor.mjs'
import { scanPaste, redactPaste, PASTE_LIMITS } from '../src/native-chatgpt/redaction.mjs'
import { validatePasteRules } from '../src/native-chatgpt/paste-rules.mjs'
import {
  capturePasteTarget,
  pasteTargetIsCurrent,
  insertNativePaste,
} from '../src/native-chatgpt/paste-target.mjs'
import { installNativePaste } from '../src/native-chatgpt/paste-controller.mjs'
import {
  PASTE_REVIEW_PORT,
  PasteReviewAction,
  PASTE_REVIEW_TTL_MS,
  trustedReviewPort,
} from '../src/native-chatgpt/review-contract.mjs'
import { createNativePasteReviewService } from '../src/background/native-paste-review.mjs'
import { RuntimeMessage } from '../src/protocol/messages.mjs'

const cleanups = []
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn())
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const fixture = (html = '<div id="prompt-textarea" contenteditable="true"><p>draft</p></div>') => {
  const dom = new JSDOM('<main><form>' + html + '</form></main>', {
    url: 'https://chatgpt.com/',
    pretendToBeVisual: true,
  })
  cleanups.push(() => dom.window.close())
  const doc = dom.window.document,
    editor = doc.getElementById('prompt-textarea')
  editor.focus()
  const range = doc.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  dom.window.getSelection().addRange(range)
  return { dom, doc, editor }
}
const callbacks = () => {
  const listeners = new Set()
  return {
    addListener: vi.fn((fn) => listeners.add(fn)),
    removeListener: vi.fn((fn) => listeners.delete(fn)),
    emit: (...args) => [...listeners].forEach((fn) => fn(...args)),
  }
}
const setup = () => {
  const { dom, doc, editor } = fixture()
  const add = vi.spyOn(dom.window, 'addEventListener')
  const expected = {
    proof: '11111111-1111-4111-8111-111111111111',
    reviewTabId: 7,
    reviewUrl: 'chrome-extension://unit/PasteReview.html?job=private',
  }
  const onConnect = callbacks()
  const browser = {
    runtime: {
      id: 'unit',
      onConnect,
      onMessage: callbacks(),
      sendMessage: vi.fn().mockResolvedValue(expected),
    },
  }
  const insert = vi.fn()
  const controller = installNativePaste({ doc, browser, insert })
  cleanups.push(controller.dispose)
  const paste = add.mock.calls.find(([name]) => name === 'paste')[1]
  const event = (raw = 'demo@example.com', extras = {}) => ({
    isTrusted: true,
    cancelable: true,
    target: editor,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    clipboardData: { types: ['text/plain'], files: [], getData: vi.fn(() => raw) },
    ...extras,
  })
  const enabled = { chatgptNativePasteEnabled: true, chatgptNativePasteTerms: [] }
  const connect = async (
    sender = { id: 'unit', tab: { id: 7 }, documentId: 'review-doc', url: expected.reviewUrl },
    proof = expected.proof,
  ) => {
    const port = {
      name: PASTE_REVIEW_PORT,
      sender,
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: callbacks(),
      onDisconnect: callbacks(),
    }
    port.disconnect.mockImplementation(() => port.onDisconnect.emit())
    onConnect.emit(port)
    port.onMessage.emit({
      action: PasteReviewAction.Authenticate,
      proof,
      jobId: browser.runtime.sendMessage.mock.calls.findLast(
        ([m]) => m.type === RuntimeMessage.OpenNativePasteReview,
      )?.[0].data.jobId,
    })
    await Promise.resolve()
    await Promise.resolve()
    return port
  }
  return { doc, dom, editor, browser, insert, controller, paste, event, enabled, connect }
}

describe('native scope and explicit rules', () => {
  it.each([
    'https://chatgpt.com/',
    'https://chatgpt.com/c/demo',
    'https://chatgpt.com/?temporary-chat=true',
  ])('supports main page %s', (url) => expect(isNativeChatgptUrl(url)).toBe(true))
  it.each([
    'http://chatgpt.com/',
    'https://evil.test/',
    'https://chatgpt.com.evil.test/',
    'https://chatgpt.com/g/g-demo',
    'https://chatgpt.com/auth/login',
    'https://chatgpt.com/?chatgptbox_proxy=1',
  ])('excludes %s', (url) => expect(isNativeChatgptUrl(url)).toBe(false))
  it('recognizes the observed native guest textarea without accepting unrelated fields', () => {
    const dom = new JSDOM(
      '<main><form><textarea id="mobile-composer-prompt" aria-label="Chat with ChatGPT"></textarea></form><textarea id="rename"></textarea></main>',
      { url: 'https://chatgpt.com/' },
    )
    cleanups.push(() => dom.window.close())
    const editor = dom.window.document.getElementById('mobile-composer-prompt')
    expect(nativeChatgptEditor(dom.window.document)).toBe(editor)
    editor.remove()
    expect(nativeChatgptEditor(dom.window.document)).toBeNull()
  })
  it('recognizes the observed logged-in markdown composer without an ID and refuses unrelated or ambiguous editors', () => {
    const markup =
      '<form><div data-composer-body><div data-composer-input><div class="ProseMirror" data-composer-markdown role="textbox" aria-multiline="true" contenteditable="true"><p>Draft</p></div></div></div></form>'
    const dom = new JSDOM(
      '<main>' +
        markup +
        '<div class="ProseMirror" contenteditable="true">Unrelated note</div></main>',
      { url: 'https://chatgpt.com/' },
    )
    cleanups.push(() => dom.window.close())
    const doc = dom.window.document,
      editor = doc.querySelector('[data-composer-markdown]')
    expect(nativeChatgptEditor(doc)).toBe(editor)
    const range = doc.createRange()
    range.selectNodeContents(editor)
    doc.defaultView.getSelection().addRange(range)
    expect(capturePasteTarget(editor).text).toBe('Draft')
    editor.closest('[data-composer-input]').removeAttribute('data-composer-input')
    expect(nativeChatgptEditor(doc)).toBeNull()
    doc.body.innerHTML = markup + markup
    expect(nativeChatgptEditor(doc)).toBeNull()
    doc.body.innerHTML = markup
    doc.querySelector('[data-composer-body]').setAttribute('aria-hidden', 'true')
    expect(nativeChatgptEditor(doc)).toBeNull()
    doc.querySelector('[data-composer-body]').removeAttribute('aria-hidden')
    dom.window.history.replaceState({}, '', '/?chatgptbox_proxy=1')
    expect(nativeChatgptEditor(doc)).toBeNull()
  })
  it('accepts only explicit opt-in and preserves invalid policy for fail-closed validation', () => {
    expect(
      nativeChatgptConfig({ chatgptNativePasteEnabled: 'true' }).chatgptNativePasteEnabled,
    ).toBe(false)
    expect(
      scanPaste(
        'draft',
        nativeChatgptConfig({ chatgptNativePasteTerms: 'broken' }).chatgptNativePasteTerms,
      ).complete,
    ).toBe(false)
  })
  it('preserves stable aliases only within an operation, with separate namespaces', () => {
    const text = '示例公司 demo@example.com 和 demo@example.com，13800138000'
    const scan = scanPaste(text, ['示例公司'], 'one')
    expect(scan.complete).toBe(true)
    const output = redactPaste(text, scan.matches)
    expect(output).not.toMatch(/示例公司|demo@example\.com|13800138000/)
    expect(output.match(/EMAIL_one_1/g)).toHaveLength(2)
    expect(redactPaste(text, scanPaste(text, [], 'two').matches)).toContain('EMAIL_two_1')
  })
  it('irreversibly masks complete long key formats and overlapping custom terms', () => {
    const key = 'sk-' + 'x'.repeat(500)
    const text = 'token ' + key + ' end'
    const scan = scanPaste(text, [key.slice(0, 20)])
    expect(scan.matches).toHaveLength(1)
    expect(scan.matches[0].locked).toBe(true)
    expect(redactPaste(text, scan.matches, [])).toBe('token [SECRET REMOVED] end')
    expect(scan.matches[0]).not.toHaveProperty('original')
  })
  it('requires review for false positives and supports explicit unchecked nonsecret items', () => {
    const text = '13800138000 demo@example.com'
    const scan = scanPaste(text)
    expect(scan.matches).toHaveLength(2)
    expect(redactPaste(text, scan.matches, [])).toBe(text)
    expect(() => redactPaste(text, scan.matches, [999])).toThrow('Invalid review')
  })
  it('does not claim arbitrary Chinese names or an unmatched text is safe', () => {
    expect(scanPaste('王小明住在示例路').matches).toEqual([])
    expect(scanPaste('ordinary draft').complete).toBe(true)
  })
  it('rejects incomplete policy, input and finding overflow without returning clean', () => {
    expect(scanPaste('x'.repeat(PASTE_LIMITS.chars + 1)).complete).toBe(false)
    expect(scanPaste('draft', Array(101).fill('private')).complete).toBe(false)
    expect(scanPaste(Array(201).fill('a@example.com').join(' ')).complete).toBe(false)
    expect(() => validatePasteRules([''])).toThrow()
    expect(() => validatePasteRules(['line\nbreak'])).toThrow()
  })
  it('keeps long negative cases bounded without hanging on an absent email separator', () => {
    const before = performance.now()
    const scan = scanPaste(
      'a'.repeat(PASTE_LIMITS.chars),
      Array.from({ length: 100 }, (_, id) => 'term-' + id),
    )
    expect(scan).toEqual({ complete: true, matches: [] })
    expect(performance.now() - before).toBeLessThan(1000)
  })
})

describe('native editor paragraph semantics', () => {
  it('preserves paragraphs, empty lines and hard line breaks', () => {
    const { editor } = fixture(
      '<div id="prompt-textarea" contenteditable="true"><p>第一行</p><p><br></p><p>第二行<br>第三行</p></div>',
    )
    expect(editorText(editor)).toBe('第一行\n\n第二行\n第三行')
  })
})

describe('paste target identity and native edit', () => {
  it('rejects a moved live caret even when the editor content is unchanged', () => {
    const { editor } = fixture('<textarea id="prompt-textarea">abcdef</textarea>')
    editor.setSelectionRange(2, 2)
    const target = capturePasteTarget(editor)
    editor.setSelectionRange(4, 4)
    expect(pasteTargetIsCurrent(target)).toBe(false)
  })
  it('captures the insertion caret instead of replacing the whole draft', () => {
    const { doc, editor } = fixture('<div id="prompt-textarea" contenteditable="true">abcdef</div>')
    const selection = doc.defaultView.getSelection(),
      range = doc.createRange()
    range.setStart(editor.firstChild, 3)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    const snapshot = capturePasteTarget(editor)
    doc.execCommand = vi.fn(() => true)
    insertNativePaste(snapshot, '[EMAIL]')
    expect(doc.execCommand).toHaveBeenCalledWith('insertText', false, '[EMAIL]')
    expect(selection.getRangeAt(0).startOffset).toBe(3)
    expect(editor.textContent).toBe('abcdef')
  })
  it('rejects same-text editor replacement, navigation and changed content', () => {
    const { doc, editor } = fixture()
    const snapshot = capturePasteTarget(editor)
    expect(pasteTargetIsCurrent(snapshot)).toBe(true)
    editor.replaceWith(editor.cloneNode(true))
    expect(pasteTargetIsCurrent(snapshot)).toBe(false)
    expect(() => insertNativePaste(snapshot, 'value')).toThrow('changed')
    expect(nativeChatgptEditor(doc)).not.toBe(editor)
  })
  it('rejects nontext contents and does not pretend a rejected native insertion succeeded', () => {
    const { doc, editor } = fixture()
    const snapshot = capturePasteTarget(editor)
    doc.execCommand = vi.fn(() => false)
    expect(() => insertNativePaste(snapshot, 'value')).toThrow('did not confirm')
    editor.append(doc.createElement('img'))
    expect(() => capturePasteTarget(editor)).toThrow('plain-text')
  })
})

describe('paste operation privacy, identity and cancellation', () => {
  it('registers synchronously; loading and disabled configuration never read clipboard data', () => {
    const s = setup(),
      before = s.event()
    s.paste(before)
    expect(before.preventDefault).toHaveBeenCalled()
    expect(before.clipboardData.getData).not.toHaveBeenCalled()
    s.controller.configure({})
    const off = s.event()
    s.paste(off)
    expect(off.preventDefault).not.toHaveBeenCalled()
    expect(off.clipboardData.getData).not.toHaveBeenCalled()
    s.controller.suspend()
    const refreshing = s.event()
    s.paste(refreshing)
    expect(refreshing.preventDefault).not.toHaveBeenCalled()
    expect(refreshing.clipboardData.getData).not.toHaveBeenCalled()
  })
  it('inserts complete zero-rule matches at the captured target without a remote request', () => {
    const s = setup()
    s.controller.configure(s.enabled)
    const event = s.event('ordinary sample')
    s.paste(event)
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
    expect(s.insert).toHaveBeenCalledWith(
      expect.objectContaining({ element: s.editor }),
      'ordinary sample',
    )
    expect(s.browser.runtime.sendMessage).not.toHaveBeenCalled()
  })
  it('keeps matched original out of the host DOM and background message, then applies selected masks', async () => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    expect(s.doc.body.textContent).not.toContain('demo@example.com')
    expect(JSON.stringify(s.browser.runtime.sendMessage.mock.calls)).not.toContain(
      'demo@example.com',
    )
    expect(s.insert).not.toHaveBeenCalled()
    const port = await s.connect()
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ original: 'demo@example.com', action: PasteReviewAction.Review }),
    )
    port.onMessage.emit({ action: PasteReviewAction.Apply, selected: [0] })
    expect(s.insert.mock.calls[0][1]).toMatch(/^\[EMAIL_/)
    expect(s.insert.mock.calls[0][1]).not.toContain('demo@example.com')
    expect(port.disconnect).toHaveBeenCalled()
  })
  it.each([
    {
      id: 'other',
      tab: { id: 7 },
      documentId: 'doc',
      url: 'chrome-extension://unit/PasteReview.html?job=private',
    },
    {
      id: 'unit',
      tab: { id: 99 },
      documentId: 'doc',
      url: 'chrome-extension://unit/PasteReview.html?job=private',
    },
    { id: 'unit', tab: { id: 7 }, documentId: 'doc', url: 'https://chatgpt.com/' },
    { id: 'unit', tab: { id: 7 }, url: 'chrome-extension://unit/Other.html' },
  ])('rejects an unauthenticated review reader', async (sender) => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const port = await s.connect(sender)
    expect(port.disconnect).toHaveBeenCalled()
    expect(port.postMessage).not.toHaveBeenCalled()
  })
  it('withholds original text without the background proof even when the extension ID matches', async () => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const rejected = await s.connect({ id: 'unit' }, 'wrong-proof')
    expect(rejected.disconnect).toHaveBeenCalled()
    expect(rejected.postMessage).not.toHaveBeenCalled()
    const accepted = await s.connect({ id: 'unit' })
    expect(accepted.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ original: 'demo@example.com' }),
    )
  })
  it('leaves unrelated website inputs untouched and blocks paste during IME composition without reading it', () => {
    const s = setup()
    s.controller.configure(s.enabled)
    const other = s.doc.createElement('textarea')
    s.doc.querySelector('main').append(other)
    const untouched = s.event('search text', { target: other })
    s.paste(untouched)
    expect(untouched.preventDefault).not.toHaveBeenCalled()
    s.editor.dispatchEvent(new s.dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    const composing = s.event('private@example.com')
    s.paste(composing)
    expect(composing.preventDefault).toHaveBeenCalled()
    expect(composing.clipboardData.getData).not.toHaveBeenCalled()
    s.editor.dispatchEvent(new s.dom.window.CompositionEvent('compositionend', { bubbles: true }))
    s.paste(s.event('plain draft'))
    expect(s.insert).toHaveBeenCalledWith(expect.anything(), 'plain draft')
  })
  it('cancels pending review when composition begins', async () => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const port = await s.connect()
    s.editor.dispatchEvent(new s.dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    expect(port.disconnect).toHaveBeenCalled()
    expect(s.insert).not.toHaveBeenCalled()
  })
  it('consumes a review connection once and rejects replay', async () => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    await s.connect()
    const duplicate = await s.connect()
    expect(duplicate.disconnect).toHaveBeenCalled()
    expect(duplicate.postMessage).not.toHaveBeenCalled()
  })
  it('rejects a second pending paste without reading or queuing its material', () => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const next = s.event('second private value')
    s.paste(next)
    expect(next.preventDefault).toHaveBeenCalled()
    expect(next.clipboardData.getData).not.toHaveBeenCalled()
    expect(s.browser.runtime.sendMessage).toHaveBeenCalledTimes(1)
  })
  it('refuses overwrite after editing, same-text replacement or navigation while reviewing', async () => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const port = await s.connect()
    s.editor.textContent = 'new draft'
    port.onMessage.emit({ action: PasteReviewAction.Apply, selected: [0] })
    expect(s.insert).not.toHaveBeenCalled()
    expect(s.editor.textContent).toBe('new draft')
  })
  it('cancels on configuration change, close/disconnect and TTL without raw fallback', async () => {
    vi.useFakeTimers()
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const port = await s.connect()
    s.controller.suspend()
    port.onMessage.emit({ action: PasteReviewAction.Apply, original: true })
    expect(s.insert).not.toHaveBeenCalled()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const second = await s.connect()
    second.onDisconnect.emit()
    expect(s.insert).not.toHaveBeenCalled()
    s.paste(s.event())
    const third = await s.connect()
    vi.advanceTimersByTime(PASTE_REVIEW_TTL_MS + 1)
    expect(third.disconnect).toHaveBeenCalled()
    expect(s.insert).not.toHaveBeenCalled()
  })
  it('requires an explicit original action and never inserts original on review failure', async () => {
    const s = setup()
    s.controller.configure(s.enabled)
    s.paste(s.event())
    const port = await s.connect()
    port.onMessage.emit({ action: PasteReviewAction.Apply, original: true, allowOriginal: true })
    expect(s.insert.mock.calls[0][1]).toBe('demo@example.com')
    s.browser.runtime.sendMessage.mockRejectedValueOnce(new Error('unavailable'))
    s.paste(s.event())
    await Promise.resolve()
    await Promise.resolve()
    expect(s.insert).toHaveBeenCalledTimes(1)
  })
  it.each([{ original: true }, { selected: [] }])(
    'requires original-sharing acknowledgement at the source for %j',
    async (data) => {
      const s = setup()
      s.controller.configure(s.enabled)
      s.paste(s.event())
      const rejected = await s.connect()
      rejected.onMessage.emit({ action: PasteReviewAction.Apply, ...data })
      expect(s.insert).not.toHaveBeenCalled()
      s.paste(s.event())
      const allowed = await s.connect()
      allowed.onMessage.emit({ action: PasteReviewAction.Apply, ...data, allowOriginal: true })
      expect(s.insert.mock.calls[0][1]).toBe('demo@example.com')
    },
  )
  it('requires acknowledgement when a custom identity replacement returns original', async () => {
    const s = setup()
    s.controller.configure({
      ...s.enabled,
      chatgptNativePasteTerms: [{ pattern: 'demo@example\\.com', flags: '', replacement: '$&' }],
    })
    s.paste(s.event())
    const port = await s.connect()
    port.onMessage.emit({ action: PasteReviewAction.Apply, selected: [0] })
    expect(s.insert).not.toHaveBeenCalled()
  })
  it('does not take over script-generated input and requires review for rich text', async () => {
    const s = setup()
    s.controller.configure(s.enabled)
    const script = s.event('script', { isTrusted: false })
    s.paste(script)
    expect(script.preventDefault).not.toHaveBeenCalled()
    const rich = s.event('ordinary', {
      clipboardData: { types: ['text/plain', 'text/html'], files: [], getData: () => 'ordinary' },
    })
    s.paste(rich)
    expect(s.insert).not.toHaveBeenCalled()
    const port = await s.connect()
    expect(port.postMessage.mock.calls[0][0].formatted).toBe(true)
  })
})

describe('background review identity and lifecycle', () => {
  const serviceFixture = () => {
    const browser = {
      runtime: { id: 'unit', getURL: (path) => 'chrome-extension://unit/' + path },
      tabs: {
        onRemoved: callbacks(),
        onUpdated: callbacks(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      windows: {
        create: vi.fn().mockResolvedValue({ id: 8, tabs: [{ id: 4 }] }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    }
    const service = createNativePasteReviewService(browser)
    cleanups.push(service.dispose)
    const request = { data: { jobId: '11111111-1111-4111-8111-111111111111' } }
    const source = {
      id: 'unit',
      frameId: 0,
      documentId: 'origin-doc',
      tab: { id: 3 },
      url: 'https://chatgpt.com/c/sample',
    }
    const reviewer = (result) => ({
      id: 'unit',
      frameId: 0,
      documentId: 'review-doc',
      tab: { id: 4, url: result.reviewUrl },
      url: result.reviewUrl,
    })
    return { browser, service, request, source, reviewer }
  }
  it('authenticates the exact browser-reported review document and issues its proof once', async () => {
    const s = serviceFixture()
    const result = await s.service.open(s.request, s.source)
    expect(result.reviewUrl).toContain('document=origin-doc')
    expect(result.reviewUrl).not.toContain(result.proof)
    for (const patch of [
      { id: 'other' },
      { frameId: 1 },
      { documentId: undefined },
      { tab: { id: 9, url: result.reviewUrl } },
      { url: result.reviewUrl + '#copied' },
    ]) {
      await expect(
        s.service.authenticate(s.request, { ...s.reviewer(result), ...patch }),
      ).rejects.toThrow()
    }
    expect(await s.service.authenticate(s.request, s.reviewer(result))).toEqual({
      proof: result.proof,
    })
    await expect(s.service.authenticate(s.request, s.reviewer(result))).rejects.toThrow()
    expect(trustedReviewPort({ id: 'unit' }, result, 'unit')).toBe(true)
    await expect(s.service.open(s.request, { ...s.source, frameId: 2 })).rejects.toThrow()
    await expect(
      s.service.open(s.request, { ...s.source, documentId: undefined }),
    ).rejects.toThrow()
  })
  it('cancels by document-bound metadata when the review closes before connecting', async () => {
    const s = serviceFixture()
    const result = await s.service.open(s.request, s.source)
    s.browser.tabs.onRemoved.emit(4)
    expect(s.browser.tabs.sendMessage).toHaveBeenCalledWith(
      3,
      {
        type: RuntimeMessage.CancelNativePasteReview,
        data: { jobId: s.request.data.jobId, proof: result.proof },
      },
      { documentId: 'origin-doc', frameId: 0 },
    )
    await expect(s.service.authenticate(s.request, s.reviewer(result))).rejects.toThrow()
  })
  it('expires, rejects a fresh-worker replay and accepts close only from the original document', async () => {
    vi.useFakeTimers()
    const s = serviceFixture()
    const result = await s.service.open(s.request, s.source)
    s.service.close(s.request, { ...s.source, documentId: 'wrong' })
    expect(await s.service.authenticate(s.request, s.reviewer(result))).toEqual({
      proof: result.proof,
    })
    vi.advanceTimersByTime(PASTE_REVIEW_TTL_MS + 1)
    await expect(s.service.authenticate(s.request, s.reviewer(result))).rejects.toThrow()
    const fresh = createNativePasteReviewService(s.browser)
    await expect(fresh.authenticate(s.request, s.reviewer(result))).rejects.toThrow()
    fresh.dispose()
  })
})
