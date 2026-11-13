/* eslint-env node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { runGeminiNativeOperation } from '../src/services/clients/gemini-web/native-runtime.mjs'
import { GEMINI_NATIVE_CONTRACTS } from '../src/config/gemini-web.mjs'

let dom
afterEach(() => {
  dom?.window.close()
  vi.unstubAllGlobals()
})

function subject(initial, hasInitial = true) {
  let value = initial
  const listeners = new Set()
  return {
    subscribe(fn) {
      listeners.add(fn)
      if (hasInitial) fn(value)
      return { unsubscribe: () => listeners.delete(fn) }
    },
    next(next) {
      value = next
      for (const fn of listeners) fn(value)
    },
    get value() {
      return value
    },
    get listeners() {
      return listeners.size
    },
  }
}

function fixture({ current = false } = {}) {
  dom = new JSDOM(
    `<script src="https://gemini.gstatic.com/_/js/k=fixture-v1/m=xqG9Nd"></script>
    <a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account: fixture@example.invalid"></a>
    <input-area-v2><rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea></input-area-v2>`,
    { url: 'https://gemini.google.com/app#chatgptbox-gemini-owner' },
  )
  const win = dom.window
  win.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }]
  const editor = win.document.querySelector('.ql-editor')
  class NativeService {
    constructor() {
      this.Ue = subject({ id: '', Ob: [] })
      this.Mb = subject(undefined, false)
      this.bardModeService = {
        oa: subject({ id: 'native-argon', description: '4 Argon' }),
        Ca: subject('THINKING_LEVEL_EXTENDED'),
      }
      this.calls = 0
      this.stops = 0
      this.generating = false
    }
    sendRequest() {
      this.calls += 1
      this.generating = true
      this.row = {
        request: {
          clientTurnId: `native-${this.calls}`,
          textQuery: this.input.Fl.value,
          jj: 'native-argon',
          thinkingLevel: 'THINKING_LEVEL_EXTENDED',
          conversationId: 'c_native',
        },
        response: { turnId: '', isFinal: false, draft: { completeness: 'PARTIAL' } },
      }
      this.Mb.next({ type: '[Conversations] Send Request', request: this.row.request })
      this.Ue.next({ id: 'c_native', Ob: [...this.Ue.value.Ob, this.row] })
      this.input.Fl.setValue('')
    }
    receive(html, { final = false, success = false, content } = {}) {
      let container = this.container
      if (!container || container.dataset.native !== this.row.request.clientTurnId) {
        container = win.document.createElement('div')
        container.className = 'conversation-container'
        container.dataset.native = this.row.request.clientTurnId
        container.innerHTML =
          '<user-query><div class="query-text-line"></div></user-query><model-response><message-content><div class="markdown"></div></message-content></model-response>'
        container.querySelector('.query-text-line').textContent = this.row.request.textQuery
        win.document.body.appendChild(container)
        this.container = container
      }
      container.querySelector('.markdown').innerHTML = html
      this.row = {
        ...this.row,
        response: {
          turnId: `server-${this.calls}`,
          isFinal: final,
          draft: {
            completeness: final ? 'COMPLETE' : 'PARTIAL',
            structuredContent: content || {
              children: [
                {
                  nodeType: 11,
                  children: [
                    { nodeType: 18, text: container.querySelector('.markdown').textContent },
                  ],
                },
              ],
            },
          },
        },
      }
      this.Ue.next({
        id: 'c_native',
        Ob: this.Ue.value.Ob.map((row) =>
          row.request.clientTurnId === this.row.request.clientTurnId ? this.row : row,
        ),
      })
      this.Mb.next({
        type: '[Conversations] Streaming Response: Turn',
        turn: this.row,
        um: { request: this.row.request },
      })
      if (success)
        this.Mb.next({
          type: '[Conversations] Generate Response Success',
          um: { request: this.row.request },
        })
      if (final && success) this.generating = false
    }
  }
  class NativeInput {
    constructor(service) {
      this.Ta = service
      service.input = this
      this.kd = true
      this.Fl = {
        value: '',
        setValue(value) {
          this.value = value
          editor.textContent = value
        },
      }
    }
    kNa(stop) {
      if (stop) {
        this.Ta.stops += 1
        this.Ta.generating = false
      } else this.Ta.sendRequest()
    }
    Lca() {
      return this.Ta.generating
    }
    U7() {
      return false
    }
    uD() {
      return false
    }
    D1() {
      return false
    }
    Wu() {
      return false
    }
    e8b() {
      return false
    }
    mRb() {
      return false
    }
    Ie() {
      return 0
    }
    turn() {
      return this.Ta.row
    }
  }
  const service = new NativeService(),
    input = new NativeInput(service)
  const runtime = {
    views: new Map([
      [
        1,
        [
          win.document.querySelector('input-area-v2'),
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          input,
        ],
      ],
    ]),
    Input: NativeInput,
    Service: NativeService,
    hEe() {},
    Gce() {},
  }
  win.default_BardChatUi = runtime
  const hash = (fn) =>
    createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex')
  const contracts = [
    {
      version: 'fixture-v1',
      viewMap: 'views',
      inputClass: 'Input',
      serviceClass: 'Service',
      modelDescription: '4 Argon',
      thinkingLevel: 'THINKING_LEVEL_EXTENDED',
      hashes: {
        submit: hash(input.kNa),
        send: hash(service.sendRequest),
        prepare: hash(runtime.hEe),
        attestation: hash(runtime.Gce),
      },
    },
  ]
  if (current) {
    const profile = GEMINI_NATIVE_CONTRACTS.find((item) => item.version.includes('qGl2D'))
    Object.assign(contracts[0], {
      fields: profile.fields,
      prepareFunction: 'GEe',
      attestationFunction: 'bde',
      thinkingSetter: 'T9d',
    })
    for (const [key, legacy] of Object.entries({
      service: 'Ta',
      submit: 'kNa',
      form: 'Fl',
      eligible: 'kd',
      generating: 'Lca',
      preparing: 'U7',
      dictating: 'uD',
      disabled: 'D1',
      editing: 'Wu',
      attachments: 'e8b',
      references: 'mRb',
      embedded: 'jc',
      feature: 'Ie',
    }))
      input[profile.fields[key]] = input[legacy]
    const request = (value) => value && Object.assign({}, value, { jj: undefined, qj: value.jj })
    const row = (value) => value && { ...value, request: request(value.request) }
    service.Ye = {
      subscribe(fn) {
        return service.Ue.subscribe((state) => fn({ id: state.id, Pb: state.Ob.map(row) }))
      },
    }
    service.Nb = {
      subscribe(fn) {
        return service.Mb.subscribe((event) =>
          fn({
            ...event,
            request: request(event.request),
            turn: row(event.turn),
            um: undefined,
            ...(event.um && { Cm: { request: request(event.um.request) } }),
          }),
        )
      },
    }
    runtime.GEe = runtime.hEe
    runtime.bde = runtime.Gce
    runtime.T9d = (modeService, level) => {
      modeService.setterCalls = (modeService.setterCalls || 0) + 1
      if (modeService.availableThinking?.includes(level)) modeService.Ca.next(level)
    }
    service.bardModeService.availableThinking = [
      'THINKING_LEVEL_STANDARD',
      'THINKING_LEVEL_EXTENDED',
    ]
    contracts[0].hashes.thinking = hash(runtime.T9d)
    delete runtime.hEe
    delete runtime.Gce
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.stubGlobal('location', win.location)
  vi.stubGlobal('Node', win.Node)
  vi.stubGlobal('getComputedStyle', win.getComputedStyle)
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('performance', { getEntriesByType: () => [] })
  const accountSalt = 'fixture-salt'
  const expectedAccountFingerprint = createHash('sha256')
    .update(accountSalt + '\nGoogle Account: fixture@example.invalid')
    .digest('hex')
  const op = (action, extra = {}) =>
    runGeminiNativeOperation({
      action,
      ownerId: 'owner',
      requestId: 'request',
      contracts,
      accountSalt,
      expectedAccountFingerprint,
      ...extra,
    })
  return {
    op,
    input,
    service,
    runtime,
    contracts,
    editor,
    win,
    accountSalt,
    expectedAccountFingerprint,
  }
}

async function prepare(f, question = 'Explain a careful migration of a browser extension.') {
  expect(await f.op('connect')).toEqual({ ok: true })
  expect(await f.op('prepare', { question })).toEqual({ ok: true })
}

describe('Gemini native runtime boundary', () => {
  it('adapts the current compiled field names and applies High through the native menu setter without sending', async () => {
    const f = fixture({ current: true })
    f.service.bardModeService.Ca.next('THINKING_LEVEL_STANDARD')
    expect(await f.op('inspect')).toMatchObject({ ready: false })
    expect(await f.op('configure')).toEqual({ ok: true })
    expect(f.service.bardModeService.setterCalls).toBe(1)
    expect(f.service.calls).toBe(0)
    expect(await f.op('inspect')).toMatchObject({ ready: true })
    await prepare(f)
    await f.op('send')
    f.service.receive('<p>Current native answer</p>', { final: true, success: true })
    expect(await f.op('observe')).toMatchObject({
      completed: true,
      answer: '<p>Current native answer</p>',
    })
    expect(f.service.calls).toBe(1)
  })

  it('does not apply thinking settings to a manual tab, switch models, or force unavailable High', async () => {
    const f = fixture({ current: true })
    f.service.bardModeService.Ca.next('THINKING_LEVEL_STANDARD')
    f.win.location.hash = ''
    expect(await f.op('configure')).toMatchObject({ code: 'GEMINI_OWNED_TAB_REQUIRED' })
    expect(f.service.bardModeService.setterCalls).toBeUndefined()
    f.win.location.hash = '#chatgptbox-gemini-owner'
    f.service.bardModeService.oa.next({ id: 'other', description: '4 Hydrogen' })
    expect(await f.op('configure')).toMatchObject({ code: 'GEMINI_MODEL_MISMATCH' })
    expect(f.service.bardModeService.setterCalls).toBeUndefined()
    f.service.bardModeService.oa.next({ id: 'native-argon', description: '4 Argon' })
    f.service.bardModeService.availableThinking = ['THINKING_LEVEL_STANDARD']
    expect(await f.op('configure')).toMatchObject({ code: 'GEMINI_MODEL_MISMATCH' })
    expect(f.service.bardModeService.Ca.value).toBe('THINKING_LEVEL_STANDARD')
    expect(f.service.calls).toBe(0)
  })

  it('checks readiness without changing the native input or invoking submission', async () => {
    const f = fixture()
    expect(await f.op('inspect')).toMatchObject({
      ok: true,
      ready: true,
      model: '4 Argon',
      thinking: 'THINKING_LEVEL_EXTENDED',
    })
    expect(f.input.Fl.value).toBe('')
    expect(f.service.calls).toBe(0)
    expect(JSON.stringify(await f.op('inspect'))).not.toContain('fixture@example.invalid')
  })

  it('uses one native handler call and never admits a local dispatch as an answer', async () => {
    const f = fixture()
    await prepare(f)
    expect(await f.op('send')).toMatchObject({ accepted: false, completed: false, answer: '' })
    expect(f.service.calls).toBe(1)
    expect(await f.op('send')).toMatchObject({ ok: false, code: 'GEMINI_ALREADY_INVOKED' })
    expect(f.service.calls).toBe(1)
    f.service.receive('<p>First fragment</p>')
    expect(await f.op('observe')).toMatchObject({
      accepted: true,
      completed: false,
      answer: '<p>First fragment</p>',
    })
    f.service.receive('<p>Final answer</p>', { final: true })
    expect((await f.op('observe')).completed).toBe(false)
    f.service.receive('<p>Final answer</p>', { final: true, success: true })
    expect(await f.op('observe')).toMatchObject({
      completed: true,
      conversationId: 'c_native',
      nativeId: 'native-1',
    })
  })

  it('does not finish on stable text, a completed transport with a partial response, or another turn', async () => {
    const f = fixture()
    await prepare(f)
    await f.op('send')
    f.service.receive('<p>Still growing</p>', { success: true })
    f.service.Mb.next({
      type: '[Conversations] Generate Response Success',
      um: { request: { clientTurnId: 'old' } },
    })
    expect((await f.op('observe')).completed).toBe(false)
    expect((await f.op('observe')).completed).toBe(false)
    f.service.Mb.next({
      type: '[Conversations] Generate Response Failure',
      um: { request: f.service.row.request },
    })
    expect(await f.op('observe')).toMatchObject({ ok: false, code: 'GEMINI_TURN_FAILED' })
  })

  it('keeps identical questions in distinct native turns and excludes the old answer', async () => {
    const f = fixture(),
      question = 'Compare explicit migration and restoration.'
    await prepare(f, question)
    await f.op('send')
    f.service.receive('<p>Old answer</p>', { final: true, success: true })
    await f.op('close')
    expect(
      await f.op('prepare', {
        requestId: 'second',
        question,
        conversationId: 'c_native',
        lastNativeId: 'native-1',
      }),
    ).toEqual({ ok: true })
    await f.op('send', { requestId: 'second' })
    f.service.Mb.next({
      type: '[Conversations] Generate Response Success',
      um: { request: { clientTurnId: 'native-1' } },
    })
    expect(await f.op('observe', { requestId: 'second' })).toMatchObject({
      accepted: false,
      answer: '',
      completed: false,
    })
    f.service.receive('<p>New answer</p>', { final: true, success: true })
    expect((await f.op('observe', { requestId: 'second' })).answer).toBe('<p>New answer</p>')
  })

  it('refuses unknown code, mock instances, changed ownership, drafts and wrong model/depth before invoking', async () => {
    const f = fixture()
    const original = f.input.kNa
    f.input.kNa = () => {}
    expect(await f.op('connect')).toMatchObject({
      code: 'GEMINI_RUNTIME_UNSUPPORTED',
      dispatched: false,
    })
    f.input.kNa = original
    f.service.bardModeService.Ca.next('THINKING_LEVEL_STANDARD')
    expect(await f.op('connect')).toMatchObject({
      code: 'GEMINI_MODEL_MISMATCH',
      dispatched: false,
    })
    f.service.bardModeService.Ca.next('THINKING_LEVEL_EXTENDED')
    f.input.Fl.setValue('Keep this existing draft')
    expect(await f.op('connect')).toMatchObject({
      code: 'GEMINI_OWNED_TAB_REQUIRED',
      dispatched: false,
    })
    f.input.Fl.setValue('')
    await prepare(f)
    expect(await f.op('send', { ownerId: 'another' })).toMatchObject({
      code: 'GEMINI_DOCUMENT_CHANGED',
      dispatched: false,
    })
    f.input.Fl.setValue('A later human edit')
    expect(await f.op('send')).toMatchObject({
      code: 'GEMINI_PREPARATION_CHANGED',
      dispatched: false,
    })
    expect(f.service.calls).toBe(0)
  })

  it('fails closed on a visible challenge and an account switch without releasing identity', async () => {
    const f = fixture()
    await prepare(f)
    f.win.document
      .querySelector('a')
      .setAttribute('aria-label', 'Google Account: changed@example.invalid')
    expect(await f.op('send')).toMatchObject({ code: 'GEMINI_ACCOUNT_CHANGED', dispatched: false })
    f.win.document
      .querySelector('a')
      .setAttribute('aria-label', 'Google Account: fixture@example.invalid')
    const challenge = f.win.document.createElement('div')
    challenge.setAttribute('role', 'dialog')
    f.win.document.body.append(challenge)
    expect(await f.op('send')).toMatchObject({ code: 'GEMINI_CHECK_REQUIRED', dispatched: false })
    expect(f.service.calls).toBe(0)
  })

  it('exports native text as inert HTML rather than reading the page answer', async () => {
    const f = fixture()
    await prepare(f)
    await f.op('send')
    f.service.receive('<p>Stale website output<script>alert(1)</script></p>', {
      final: true,
      success: true,
      content: {
        children: [
          {
            nodeType: 11,
            children: [{ nodeType: 18, text: 'Native answer <script>alert(1)</script>' }],
          },
        ],
      },
    })
    const result = await f.op('observe')
    expect(result.completed).toBe(true)
    expect(result.answer).toBe('<p>Native answer &lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })

  it('keeps final content tied to native state when an old identical-question DOM is rebuilt', async () => {
    const f = fixture()
    await prepare(f)
    await f.op('send')
    f.service.receive('<p>Current partial DOM</p>', { final: true, success: true })
    f.service.container.replaceWith(f.service.container.cloneNode(true))
    f.win.document.querySelector('.markdown').textContent = 'Historical answer after DOM rebuild'
    expect(await f.op('observe')).toMatchObject({
      completed: true,
      answer: '<p>Current partial DOM</p>',
    })
  })

  it('preserves native code/lists/tables and refuses unknown content instead of fabricating a final answer', async () => {
    const f = fixture()
    await prepare(f)
    await f.op('send')
    const leaf = (text) => ({ nodeType: 18, text })
    f.service.receive('<p>Not the answer source</p>', {
      final: true,
      success: true,
      content: {
        children: [
          { nodeType: 1, code: '<unsafe>' },
          { nodeType: 20, items: [{ children: [leaf('Item')] }] },
          { nodeType: 17, rows: [{ cells: [{ children: [leaf('Cell')] }] }] },
        ],
      },
    })
    expect((await f.op('observe')).answer).toBe(
      '<pre><code>&lt;unsafe&gt;</code></pre><ul><li>Item</li></ul><table><tr><td>Cell</td></tr></table>',
    )
    f.service.receive('', {
      final: true,
      success: true,
      content: { children: [{ nodeType: 999, text: 'Unknown' }] },
    })
    expect(await f.op('observe')).toMatchObject({
      ok: false,
      code: 'GEMINI_NATIVE_OPERATION_FAILED',
    })
    expect(f.service.calls).toBe(1)
  })

  it('detects a native submission during preparation even if busy/draft later appear unchanged', async () => {
    const f = fixture(),
      question = 'Explain a careful migration.'
    await prepare(f, question)
    f.service.sendRequest()
    f.service.generating = false
    f.input.Fl.setValue(question)
    const result = await f.op('send')
    expect(result).toMatchObject({ ok: false, code: 'GEMINI_PREPARATION_CHANGED' })
    expect(result).not.toHaveProperty('dispatched')
    expect(f.service.calls).toBe(1)
  })

  it('stops only its matching turn once and detaches subscriptions on close', async () => {
    const f = fixture()
    await prepare(f)
    await f.op('send')
    f.service.receive('<p>Partial</p>')
    expect(await f.op('stop')).toMatchObject({ stopAttempted: true })
    await f.op('stop')
    expect(f.service.stops).toBe(1)
    await f.op('close')
    expect(f.service.Ue.listeners).toBe(0)
    expect(f.service.Mb.listeners).toBe(0)
  })

  it('rejects a different pinned account and can detach after native settings change', async () => {
    const f = fixture()
    expect(await f.op('connect', { expectedAccountFingerprint: 'b'.repeat(64) })).toMatchObject({
      code: 'GEMINI_ACCOUNT_CHANGED',
      dispatched: false,
    })
    await prepare(f)
    await f.op('send')
    f.service.bardModeService.Ca.next('THINKING_LEVEL_STANDARD')
    expect(await f.op('close', { requestId: 'other' })).toMatchObject({ ok: false })
    expect(f.service.Mb.listeners).toBe(1)
    expect(await f.op('close')).toEqual({ ok: true })
    expect(f.service.Mb.listeners).toBe(0)
    expect(f.service.calls).toBe(1)
  })

  it('remains self-contained when serialized for MAIN execution', async () => {
    const f = fixture()
    const serialized = new Function(`return (${runGeminiNativeOperation.toString()})`)()
    expect(
      await serialized({ action: 'inspect', contracts: f.contracts, accountSalt: f.accountSalt }),
    ).toMatchObject({ ok: true, ready: true })
  })
})
