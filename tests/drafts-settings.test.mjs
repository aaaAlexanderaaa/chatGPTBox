/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { draftsCredential } from './helpers/drafts-credential.mjs'
import { createDraftsFileManager } from './helpers/drafts-file-manager.mjs'

const path = '/ChatGPTBox/settings.json'
const scripts = Object.fromEntries(
  Object.entries({
    list: 'action-1-list-conversations.js',
    get: 'action-2-open-checked-conversation.js',
    send: 'action-3-send-waiting-reply.js',
    more: 'more.js',
  }).map(([name, file]) => [
    name,
    fs.readFileSync(new URL('../docs/drafts/scripts/' + file, import.meta.url), 'utf8'),
  ]),
)
const ok = (responseData) => ({ success: true, statusCode: 200, responseData })
const receipt = {
  engineId: 'geminiweb',
  runId: 'run-one',
  conversationId: 'thread-one',
  messageId: 'user-one',
  query: 'Question',
  pending: true,
}
const uncertain = {
  success: false,
  statusCode: 409,
  responseData: { error: { code: 'ambiguous_dispatch', message: 'Acknowledgement lost' } },
}
const conversation = [
  '# Conversation',
  'Conversation ID: thread-one',
  '## Waiting Reply',
  '<!-- chatgptbox-waiting-reply:start {"conversationId":"thread-one"} -->',
  'Question',
  '<!-- chatgptbox-waiting-reply:end -->',
].join('\n')
const meta = (content) => JSON.parse(content.match(/^<!-- chatgptbox-document:(\{[^\n]*\}) -->/)[1])

function run(
  action,
  content,
  manager,
  { buttons = [], respond, onShow, credential = draftsCredential } = {},
) {
  const requests = [],
    menus = []
  const draft = { content, update: vi.fn() }
  const app = { displayErrorMessage: vi.fn(), displaySuccessMessage: vi.fn() }
  const credentials = { create: vi.fn((...args) => credential.create(...args)) }
  let error
  try {
    vm.runInNewContext(scripts[action], {
      draft,
      app,
      FileManager: manager,
      Credential: credentials,
      HTTP: {
        create: () => ({
          request(request) {
            requests.push(JSON.parse(JSON.stringify(request)))
            return respond ? respond(request) : ok(receipt)
          },
        }),
      },
      Prompt: {
        create: () => ({
          buttons: [],
          fieldValues: {},
          addButton(label) {
            this.buttons.push(label)
          },
          addTextField(key, label, value) {
            this.fieldValues[key] = value
          },
          addSwitch(key, label, value) {
            this.fieldValues[key] = value
          },
          addPicker(key, label, values, initial) {
            this.fieldValues[key] = initial
          },
          show() {
            menus.push(this)
            const selection = buttons.shift()
            if (!selection) return false
            this.buttonPressed = typeof selection === 'string' ? selection : selection.button
            Object.assign(this.fieldValues, selection.values)
            onShow?.(this)
            return true
          },
        }),
      },
    })
  } catch (caught) {
    error = caught
  }
  return { requests, menus, draft, app, credentials, error }
}

function save(manager, values, content = 'Keep my question') {
  return run('more', content, manager, { buttons: ['设置', { button: '保存', values }] })
}

describe('Drafts More → 设置 across the generated action packages', () => {
  it('saves once and shares URL, model and display preferences across independent action contexts', () => {
    const manager = createDraftsFileManager(null)
    const saved = save(manager, {
      baseUrl: ' https://gateway.example/ ',
      modelOverride: ' model-one ',
      includeThinking: true,
    })
    expect(saved.error).toBeUndefined()
    expect(saved.credentials.create).not.toHaveBeenCalled()
    expect(saved.requests).toEqual([])
    expect(saved.draft.update).not.toHaveBeenCalled()
    expect(saved.draft.content).toBe('Keep my question')
    expect(saved.app.displaySuccessMessage).toHaveBeenCalledOnce()
    expect(JSON.parse(manager.files.get(path))).toEqual({
      version: 1,
      baseUrl: 'https://gateway.example',
      modelOverride: 'model-one',
      includeThinking: true,
    })
    expect(manager.files.size).toBe(1)
    expect(manager.files.get(path)).not.toContain('synthetic-token')

    const listed = run('list', '', manager, { respond: () => ok({ items: [] }) })
    const get = run('get', conversation, manager, {
      respond: () => ok({ conversationId: 'thread-one', messages: [] }),
    })
    const sent = run('send', conversation, manager)
    const project = run('more', 'Question', manager, {
      buttons: ['选择 Project', '保存'],
      respond: () => ok({ projects: [] }),
    })
    for (const result of [listed, get, sent, project]) {
      expect(result.error).toBeUndefined()
      expect(result.requests).toHaveLength(1)
      expect(result.requests[0].url).toMatch(/^https:\/\/gateway.example\//)
      expect(result.requests[0].headers.Authorization).toBe('Bearer synthetic-token')
    }
    expect(get.requests[0].url).toContain('think=true')
    expect(sent.requests[0].data).toEqual({ query: 'Question', model: 'model-one', think: true })
    const reopened = run('more', '', manager, { buttons: ['设置'] })
    expect(reopened.menus[1].fieldValues).toEqual({
      baseUrl: 'https://gateway.example',
      modelOverride: 'model-one',
      includeThinking: true,
    })
    expect(reopened.draft.content).toBe('')
    expect(reopened.requests).toEqual([])
    expect(manager.files.size).toBe(1)
  })

  it('requires an explicit first save and then retains defaults and existing gateway credentials', () => {
    const manager = createDraftsFileManager(null)
    const credential = {
      create: () => ({
        ...draftsCredential.create(),
        getValue: (key) =>
          key === 'baseUrl' ? 'http://existing-gateway:18080' : 'synthetic-token',
      }),
    }
    const missing = run('send', 'Question', manager, { credential })
    expect(missing.error?.message).toContain('此设备未找到共享设置')
    expect(missing.requests).toEqual([])
    expect(manager.files.size).toBe(0)
    const opened = run('more', 'Question', manager, { buttons: ['设置'] })
    expect(opened.error).toBeUndefined()
    expect(opened.menus[1].fieldValues).toEqual({
      baseUrl: '',
      modelOverride: '',
      includeThinking: false,
    })
    expect(manager.files.size).toBe(0)
    expect(save(manager, {}).error).toBeUndefined()
    const sent = run('send', 'Question', manager, { credential })
    expect(sent.error).toBeUndefined()
    expect(sent.requests[0].url).toBe('http://existing-gateway:18080/chatgpt/conversations')
    expect(sent.requests[0].data).toEqual({ query: 'Question' })
  })

  it('blocks every network action when the shared settings file has not synced to this device', () => {
    const manager = createDraftsFileManager(null)
    for (const [action, content, buttons] of [
      ['list', ':g ', []],
      ['get', conversation, []],
      ['send', 'Question', []],
      ['more', 'Question', ['选择 Project']],
    ]) {
      const result = run(action, content, manager, { buttons })
      expect(result.error?.message).toContain('同步并下载')
      expect(result.requests).toEqual([])
      expect(result.draft.content).toBe(content)
      expect(result.draft.update).not.toHaveBeenCalled()
      expect(result.credentials.create).not.toHaveBeenCalled()
      expect(manager.files.size).toBe(0)
    }
  })

  it('uses the common URL for Gemini without applying ChatGPT model or display options', () => {
    const manager = createDraftsFileManager({
      baseUrl: 'http://gateway:18080',
      modelOverride: 'chatgpt-model',
      includeThinking: true,
    })
    const sent = run('send', ':g Question', manager)
    expect(sent.error).toBeUndefined()
    expect(sent.requests[0].url).toBe('http://gateway:18080/engines/geminiweb/runs')
    expect(sent.requests[0].data).toEqual({
      contractVersion: 1,
      operation: 'generation.start',
      input: { prompt: 'Question' },
    })
    const listed = run('list', ':g ', manager, { respond: () => ok({ items: [] }) })
    expect(listed.error).toBeUndefined()
    expect(listed.requests[0].url).toContain('http://gateway:18080/engines/geminiweb/conversations')
  })

  it.each([':c Question', ':g Question', conversation])(
    'cancels settings and token instructions without HTTP, note, file or credential writes (%s)',
    (content) => {
      const manager = createDraftsFileManager({ modelOverride: 'saved-model' })
      const original = manager.files.get(path)
      for (const buttons of [
        [],
        ['设置'],
        [
          '设置',
          { button: 'API token 设置说明', values: { modelOverride: 'unsaved-model' } },
          '返回设置',
        ],
      ]) {
        const result = run('more', content, manager, { buttons })
        expect(result.error).toBeUndefined()
        expect(result.credentials.create).not.toHaveBeenCalled()
        expect(result.requests).toEqual([])
        expect(result.draft.content).toBe(content)
        expect(result.draft.update).not.toHaveBeenCalled()
        expect(manager.files.get(path)).toBe(original)
        expect(result.app.displaySuccessMessage).not.toHaveBeenCalled()
        if (result.menus.length === 4)
          expect(result.menus[3].fieldValues.modelOverride).toBe('unsaved-model')
      }
    },
  )

  it.each([
    '{broken',
    'null',
    '[]',
    '{"version":2}',
    JSON.stringify({ version: 1, baseUrl: null, modelOverride: null, includeThinking: 'false' }),
    JSON.stringify({
      version: 1,
      baseUrl: 'https://user:secret@host/',
      modelOverride: null,
      includeThinking: false,
    }),
    JSON.stringify({
      version: 1,
      baseUrl: null,
      modelOverride: 'bad model',
      includeThinking: false,
    }),
    JSON.stringify({
      version: 1,
      baseUrl: null,
      modelOverride: null,
      includeThinking: false,
      apiToken: 'must-not-load',
    }),
  ])(
    'blocks invalid configuration before HTTP instead of silently using defaults (%s)',
    (invalid) => {
      const manager = createDraftsFileManager()
      manager.files.set(path, invalid)
      for (const [action, content, options] of [
        ['list', '', {}],
        ['get', conversation, {}],
        ['send', 'Question', {}],
        ['more', 'Question', { buttons: ['选择 Project'] }],
      ]) {
        const result = run(action, content, manager, options)
        expect(result.error).toBeDefined()
        expect(result.requests).toEqual([])
        expect(result.draft.content).toBe(content)
        expect(result.draft.update).not.toHaveBeenCalled()
        expect(result.credentials.create).not.toHaveBeenCalled()
        expect(manager.files.get(path)).toBe(invalid)
      }
    },
  )

  it('requires explicit repair and Save to replace malformed settings', () => {
    const manager = createDraftsFileManager()
    manager.files.set(path, '{broken')
    for (const buttons of [['设置'], ['设置', '重新设置']]) {
      const result = run('more', ':g Future question', manager, { buttons })
      expect(result.error).toBeUndefined()
      expect(manager.files.get(path)).toBe('{broken')
      expect(result.draft.content).toBe(':g Future question')
      expect(result.requests).toEqual([])
    }
    const result = run('more', ':g Future question', manager, {
      buttons: ['设置', '重新设置', { button: '保存', values: { modelOverride: 'repaired' } }],
    })
    expect(result.error).toBeUndefined()
    expect(JSON.parse(manager.files.get(path)).modelOverride).toBe('repaired')
    expect(result.requests).toEqual([])
    expect(result.draft.update).not.toHaveBeenCalled()
  })

  it.each(['existence', 'read'])(
    'blocks unavailable iCloud files without defaults or destructive repair (%s)',
    (failure) => {
      const manager = createDraftsFileManager({ modelOverride: 'original' })
      const cloud = manager.createCloud()
      if (failure === 'existence') cloud.lastError = 'Cloud unavailable'
      else cloud.readString = () => undefined
      const original = manager.files.get(path)
      for (const action of ['send', 'more']) {
        const result = run(action, 'Question', manager, { buttons: ['设置', '重新设置', '保存'] })
        expect(result.error?.message).toContain('无法读取共享设置')
        expect(result.requests).toEqual([])
        expect(result.credentials.create).not.toHaveBeenCalled()
        expect(manager.files.get(path)).toBe(original)
      }
    },
  )

  it.each(['write', 'readback', 'replace'])(
    'does not report success or replace the original settings when storage fails (%s)',
    (failure) => {
      const manager = createDraftsFileManager({ modelOverride: 'original' })
      const cloud = manager.createCloud(),
        original = manager.files.get(path)
      if (failure === 'write') cloud.writeJSON = () => false
      if (failure === 'replace') cloud.moveItem = () => false
      if (failure === 'readback')
        cloud.readString = (file) => (file === path ? original : undefined)
      const result = save(manager, { modelOverride: 'new-model' })
      expect(result.error).toBeDefined()
      expect(result.app.displaySuccessMessage).not.toHaveBeenCalled()
      expect(result.requests).toEqual([])
      expect(result.draft.update).not.toHaveBeenCalled()
      expect(manager.files.get(path)).toBe(original)
      expect(manager.files.size).toBeLessThanOrEqual(2)
    },
  )

  it('rejects a stale settings editor instead of overwriting a newer save', () => {
    const manager = createDraftsFileManager({ modelOverride: 'original' })
    const newer = JSON.stringify({
      version: 1,
      baseUrl: null,
      modelOverride: 'newer',
      includeThinking: false,
    })
    const result = run('more', 'Question', manager, {
      buttons: ['设置', { button: '保存', values: { modelOverride: 'stale' } }],
      onShow: (prompt) => {
        if (prompt.title === 'ChatGPTBox 设置') manager.files.set(path, newer)
      },
    })
    expect(result.error?.message).toContain('其他操作修改')
    expect(manager.files.get(path)).toBe(newer)
    expect(result.app.displaySuccessMessage).not.toHaveBeenCalled()
    expect(result.requests).toEqual([])
  })

  it('does not mistake a missing final file for a successful save of the defaults', () => {
    const manager = createDraftsFileManager(null)
    manager.createCloud().moveItem = () => true
    const result = save(manager, {})
    expect(result.error?.message).toContain('无法确认共享设置已保存')
    expect(result.app.displaySuccessMessage).not.toHaveBeenCalled()
    expect(manager.files.has(path)).toBe(false)
    expect(result.requests).toEqual([])
  })

  it.each([
    'https://host/?token=x',
    'https://user:password@host',
    'https://host/#fragment',
    'file:///tmp/gateway',
  ])('keeps invalid URL edits out of saved configuration (%s)', (baseUrl) => {
    const manager = createDraftsFileManager(null)
    const result = save(manager, { baseUrl })
    expect(result.error).toBeUndefined()
    expect(result.app.displayErrorMessage).toHaveBeenCalled()
    expect(result.app.displaySuccessMessage).not.toHaveBeenCalled()
    expect(result.requests).toEqual([])
    expect(manager.files.size).toBe(0)
  })

  it('preserves the exact pending text request and key when model and display settings change', () => {
    const manager = createDraftsFileManager({ modelOverride: 'model-one', includeThinking: true })
    const first = run('send', conversation, manager, { respond: () => uncertain })
    expect(first.requests).toHaveLength(1)
    const original = first.draft.content
    const edited = save(manager, { modelOverride: 'model-two', includeThinking: false }, original)
    expect(edited.error).toBeUndefined()
    expect(edited.draft.content).toBe(original)
    const recovered = run('send', original, manager, { respond: () => ok(receipt) })
    expect(recovered.error).toBeUndefined()
    expect(recovered.requests).toHaveLength(1)
    expect(recovered.requests[0].data).toEqual(first.requests[0].data)
    expect(recovered.requests[0].headers['Idempotency-Key']).toBe(
      first.requests[0].headers['Idempotency-Key'],
    )
  })

  it.each(['c', 'g'])(
    'keeps pending identities and gateway bindings after settings changes (%s)',
    (engine) => {
      const manager = createDraftsFileManager()
      const first = run('send', ':' + engine + ' Question', manager)
      expect(first.error).toBeUndefined()
      const original = first.draft.content,
        pending = meta(original)
      const changed = save(
        manager,
        {
          baseUrl: 'https://another-gateway.example',
          modelOverride: 'model-two',
          includeThinking: true,
        },
        original,
      )
      expect(changed.error).toBeUndefined()
      expect(changed.requests).toEqual([])
      expect(changed.draft.content).toBe(original)
      expect(meta(changed.draft.content)).toEqual(pending)
      for (const action of ['get', 'send']) {
        const result = run(action, original, manager)
        expect(result.error?.message).toContain('different gateway')
        expect(result.requests).toEqual([])
        expect(result.draft.content).toBe(original)
      }
      expect(save(manager, { baseUrl: '' }).error).toBeUndefined()
      const restored = run('get', original, manager, {
        respond: () =>
          engine === 'g'
            ? ok({ engineId: 'geminiweb', runId: 'run-one', phase: 'running' })
            : ok({ conversationId: 'thread-one', messages: [], pending: true }),
      })
      expect(restored.error).toBeUndefined()
      expect(restored.requests.every((request) => request.method === 'GET')).toBe(true)
      expect(restored.requests[0].url).toMatch(/^http:\/\/127.0.0.1:18080\//)
    },
  )
})
