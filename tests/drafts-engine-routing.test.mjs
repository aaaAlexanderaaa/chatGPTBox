/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { draftsCredential } from './helpers/drafts-credential.mjs'
import { syncDraftsActions } from '../scripts/sync-drafts-engines.mjs'

const files = {
  list: 'action-1-list-conversations.js',
  get: 'action-2-open-checked-conversation.js',
  send: 'action-3-send-waiting-reply.js',
  more: 'more.js',
}
const sources = Object.fromEntries(
  Object.entries(files).map(([name, file]) => [
    name,
    fs.readFileSync(new URL('../docs/drafts/scripts/' + file, import.meta.url), 'utf8'),
  ]),
)
const ok = (responseData) => ({ success: true, statusCode: 200, responseData })
const meta = (content) => JSON.parse(content.match(/^<!-- chatgptbox-document:(\{[^\n]*\}) -->/)[1])
const geminiDetail = {
  conversationId: 'c_abcdefgh',
  conversationRef: 'native-conversation',
  conversationRevision: 3,
  serverHead: 'head-one',
  nextCursor: 'older',
  messages: [
    { role: 'user', content: 'Old question' },
    { role: 'assistant', content: '<p>Old answer</p>', completed: true },
  ],
}

function run(action, content, options = {}) {
  const requests = [],
    menus = [],
    saves = [],
    buttons = [...(options.buttons || [])]
  const draft = {
    content,
    update: vi.fn(() => {
      if (options.failSave === 'throw' || options.failSave === saves.length + 1)
        throw new Error('Draft save failed')
      if (options.failSave === 'false') return false
      saves.push(draft.content)
      return true
    }),
  }
  const app = { displayErrorMessage: vi.fn(), displaySuccessMessage: vi.fn() }
  let error
  try {
    vm.runInNewContext(options.source || sources[action], {
      draft,
      app,
      Credential: options.credential || draftsCredential,
      HTTP: {
        create: () => ({
          request(request) {
            requests.push(JSON.parse(JSON.stringify(request)))
            return options.respond
              ? options.respond(request, draft, saves)
              : ok({
                  engineId: 'geminiweb',
                  runId: 'run-one',
                  conversationId: 'thread-one',
                  messageId: 'user-one',
                  pending: true,
                })
          },
        }),
      },
      Prompt: {
        create: () => {
          const prompt = {
            buttons: [],
            fieldValues: {},
            addButton(label) {
              this.buttons.push(label)
            },
            addPicker(key, label, values, initial) {
              this.fieldValues[key] = [options.pickerIndex ?? initial[0]]
            },
            show() {
              menus.push(this)
              const button = buttons.shift()
              if (button === undefined || button === false) return false
              this.buttonPressed = button
              return true
            },
          }
          return prompt
        },
      },
      FileManager: {
        createLocal: () => ({ createDirectory() {}, writeJSON: () => true, readJSON: () => null }),
      },
      HTMLPreview: { create: () => ({ show: () => false }) },
      context: {},
    })
  } catch (caught) {
    error = caught
  }
  return { draft, requests, saves, menus, error, app }
}

function opened(engine = 'g') {
  const list = run('list', ':' + engine + ' ', {
    respond: () =>
      ok({
        items:
          engine === 'g'
            ? [{ conversationRef: 'listed-conversation', title: 'History' }]
            : [{ id: 'thread-one', title: 'History' }],
      }),
  })
  expect(list.error).toBeUndefined()
  const result = run('get', list.draft.content.replace('- [ ]', '- [x]'), {
    respond: () =>
      ok(
        engine === 'g'
          ? geminiDetail
          : { conversationId: 'thread-one', title: 'History', messages: [], pending: false },
      ),
  })
  expect(result.error).toBeUndefined()
  return result.draft.content
}
function waiting(content, query) {
  const value = meta(content)
  if (value.version === 2)
    return content.replace(
      new RegExp(
        '(<!-- chatgptbox-' +
          value.id +
          '-waiting-reply:start [^\\n]* -->)[\\s\\S]*?(<!-- chatgptbox-' +
          value.id +
          '-waiting-reply:end -->)',
      ),
      '$1\n' + query + '\n$2',
    )
  return content.replace(
    new RegExp(
      '(<!-- chatgptbox-' +
        value.id +
        '-waiting:start -->)[\\s\\S]*?(<!-- chatgptbox-' +
        value.id +
        '-waiting:end -->)',
    ),
    '$1\n' + query + '\n$2',
  )
}

describe('Drafts engine prefix routing at the generated action boundary', () => {
  it.each([
    ['', 2, '/chatgpt/conversations'],
    [':c ', 2, '/chatgpt/conversations'],
    [':g ', 3, '/engines/geminiweb/conversations'],
    [':g\n', 3, '/engines/geminiweb/conversations'],
    [':G\r\n', 3, '/engines/geminiweb/conversations'],
  ])('lists through the selected/default engine (%j)', (prefix, version, endpoint) => {
    const result = run('list', prefix, { respond: () => ok({ items: [] }) })
    expect(result.error).toBeUndefined()
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].url).toContain(endpoint)
    expect(result.requests[0].method).toBe('GET')
    expect(meta(result.draft.content).version).toBe(version)
  })

  it.each(['', ':c ', ':g ', ':g\n', '\uFEFF:g\t'])(
    'removes only the initial selector and persists the complete request before a new send (%j)',
    (prefix) => {
      const question = '请分析这个问题。\n:g 这一行是问题内容。'
      const gemini = prefix.includes(':g')
      const result = run('send', prefix + question, {
        respond: (request, draft, saves) => {
          expect(saves.length).toBeGreaterThan(0)
          const header = meta(draft.content)
          expect(header.gatewayUrl).toBe('http://127.0.0.1:18080')
          expect(header.version).toBe(gemini ? 3 : 2)
          if (gemini) {
            expect(header.pending.request).toEqual(request.data)
            expect(header.pending.key).toBe(request.headers['Idempotency-Key'])
            expect(request.data.input.prompt).toBe(question)
          } else {
            expect(request.data.query).toBe(question)
            expect(draft.content).toContain(request.headers['Idempotency-Key'])
          }
          return ok({
            engineId: 'geminiweb',
            runId: 'run-one',
            conversationId: 'thread-one',
            messageId: 'user-one',
            pending: true,
          })
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.requests).toHaveLength(1)
      expect(result.requests[0].url).toContain(
        gemini ? '/engines/geminiweb/runs' : '/chatgpt/conversations',
      )
    },
  )

  it.each([
    ':x Question',
    ':constructor Question',
    ':unknown Question',
    ':g缺少空格',
    ':g:',
    '<!-- chatgptbox-document:{broken} -->\nQuestion',
    '<!-- chatgptbox-document:{"version":4,"id":"abcdefghijklmnop","kind":"conversation"} -->\nQuestion',
  ])('rejects an unknown selector or damaged/unknown binding without mutation (%j)', (content) => {
    const result = run('send', content)
    expect(result.error).toBeDefined()
    expect(result.requests).toEqual([])
    expect(result.saves).toEqual([])
    expect(result.draft.content).toBe(content)
  })

  it.each(['c', 'g'])(
    'keeps the bound engine for replies and treats a reply prefix as ordinary text (%s)',
    (engine) => {
      const query = engine === 'g' ? ':c 这是回复内容' : ':g 这是回复内容'
      const result = run('send', waiting(opened(engine), query))
      expect(result.error).toBeUndefined()
      expect(result.requests).toHaveLength(1)
      expect(
        engine === 'g' ? result.requests[0].data.input.prompt : result.requests[0].data.query,
      ).toBe(query)
      expect(result.requests[0].url).toContain(
        engine === 'g' ? '/engines/geminiweb/runs' : '/chatgpt/conversations/thread-one/messages',
      )
    },
  )

  it.each(['list', 'get', 'send', 'more'])(
    'refuses to switch a bound note before any request or mutation (%s)',
    (action) => {
      for (const engine of ['c', 'g']) {
        const content = (engine === 'g' ? ':c ' : ':g ') + opened(engine)
        const result = run(action, content)
        expect(result.error?.message).toContain('engine cannot change')
        expect(result.requests).toEqual([])
        expect(result.saves).toEqual([])
        expect(result.draft.content).toBe(content)
      }
    },
  )

  it('preserves old unversioned ChatGPT bindings against a Gemini prefix', () => {
    const content =
      ':g # Conversation\nConversation ID: thread-one\n## Waiting Reply\n<!-- chatgptbox-waiting-reply:start {"conversationId":"thread-one"} -->\nQuestion\n<!-- chatgptbox-waiting-reply:end -->'
    const result = run('send', content)
    expect(result.requests).toEqual([])
    expect(result.draft.content).toBe(content)
    expect(result.error?.message).toContain('engine cannot change')
  })

  it('refreshes an unversioned ChatGPT list and blocks Send and photo/Project preparation before any mutation', () => {
    const content = '- [x] Original | date <!-- chatgptbox-conversation:thread-one -->'
    const listed = run('list', content, {
      respond: () => ok({ items: [{ id: 'thread-two', title: 'Refreshed' }] }),
    })
    expect(listed.error).toBeUndefined()
    expect(listed.requests).toHaveLength(1)
    expect(listed.requests[0].method).toBe('GET')
    expect(listed.requests[0].url).toContain('/chatgpt/conversations?')
    expect(meta(listed.draft.content)).toMatchObject({ version: 2, kind: 'list' })
    expect(listed.draft.content).toContain('Refreshed')
    for (const action of ['send', 'photos', 'project']) {
      const result = run(action === 'send' ? 'send' : 'more', content, {
        source:
          action === 'send'
            ? sources.send
            : sources.more.replace("const ACTION = 'more'", "const ACTION = '" + action + "'"),
      })
      expect(result.error?.message).toContain('Use Get')
      expect(result.requests).toEqual([])
      expect(result.saves).toEqual([])
      expect(result.draft.content).toBe(content)
    }
    const more = run('more', content)
    expect(more.menus[0].buttons).toEqual(['网关设置说明'])
    expect(more.requests).toEqual([])
    expect(more.draft.content).toBe(content)
  })

  it.each(['Some unsent text', ':g Some unsent text'])(
    'does not overwrite ordinary text with List (%j)',
    (content) => {
      const result = run('list', content)
      expect(result.error).toBeDefined()
      expect(result.requests).toEqual([])
      expect(result.draft.content).toBe(content)
    },
  )

  it.each(['c', 'g'])(
    'does not replace a bound conversation or pending request with List (%s)',
    (engine) => {
      const pending = run('send', ':' + engine + ' Question').draft.content
      const result = run('list', pending)
      expect(result.error).toBeDefined()
      expect(result.requests).toEqual([])
      expect(result.draft.content).toBe(pending)
    },
  )

  it('selects a Project through More, strips the new-note selector, and locks the prepared note to ChatGPT', () => {
    const result = run('more', ':c 请分析餐食', {
      buttons: ['选择 Project', '保存'],
      pickerIndex: 1,
      respond: () => ok({ projects: [{ id: 'project-one', name: 'Meals' }] }),
    })
    expect(result.error).toBeUndefined()
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].url).toContain('/chatgpt/projects')
    expect(result.menus[0].buttons).toContain('选择 Project')
    expect(meta(result.draft.content).version).toBe(2)
    expect(result.draft.content).toContain('project-one')
    expect(result.draft.content).not.toContain(':c 请')
    const send = run('send', result.draft.content)
    expect(send.error).toBeUndefined()
    expect(send.requests[0].data).toMatchObject({ query: '请分析餐食', project_id: 'project-one' })
    const conflict = run('send', ':g ' + result.draft.content)
    expect(conflict.requests).toEqual([])
    expect(conflict.draft.content).toBe(':g ' + result.draft.content)
  })

  it('exposes only supported More operations without an engine picker', () => {
    const gemini = run('more', ':g Question')
    expect(gemini.menus[0].buttons).toEqual(['网关设置说明'])
    expect(gemini.requests).toEqual([])
    expect(gemini.draft.content).toBe(':g Question')
    const older = run('more', waiting(opened(), 'Future question'), {
      buttons: ['加载更早消息'],
      respond: () =>
        ok({
          ...geminiDetail,
          nextCursor: null,
          messages: [{ role: 'user', content: 'Earlier question' }],
        }),
    })
    expect(older.error).toBeUndefined()
    expect(older.requests).toHaveLength(1)
    expect(older.requests[0].url).toContain('&cursor=older')
    expect(older.draft.content).toContain('Future question')
    expect(older.draft.content).toContain('Old answer')
  })

  it.each(['project', 'photos'])(
    'rejects unsupported Gemini preparation before HTTP (%s)',
    (operation) => {
      const content = ':g Question'
      const result = run('more', content, {
        source: sources.more.replace("const ACTION = 'more'", "const ACTION = '" + operation + "'"),
      })
      expect(result.error?.message).toContain('does not support')
      expect(result.requests).toEqual([])
      expect(result.draft.content).toBe(content)
    },
  )

  it('preserves the original prefixed note when a menu, Project picker, photo picker or credentials are cancelled', () => {
    const content = ':c Keep this question'
    for (const options of [
      {},
      { buttons: ['选择 Project', false], respond: () => ok({ projects: [] }) },
      { buttons: ['添加照片'] },
      {
        credential: {
          create: () => ({ addURLField() {}, addPasswordField() {}, authorize: () => false }),
        },
        source: sources.send,
      },
    ]) {
      const result = run('more', content, options)
      expect(result.error).toBeUndefined()
      expect(result.saves).toEqual([])
      expect(result.requests.every((request) => request.method === 'GET')).toBe(true)
      expect(result.draft.content).toBe(content)
    }
  })

  it.each(['throw', 'false'])(
    'does not submit or remove the selector if the durable save fails (%s)',
    (failSave) => {
      for (const prefix of [':c ', ':g ']) {
        const content = prefix + 'Keep the original question'
        const result = run('send', content, { failSave })
        expect(result.error).toBeDefined()
        expect(result.requests).toEqual([])
        expect(result.draft.content).toBe(content)
      }
    },
  )

  it('retains the frozen Gemini request after a successful write followed by failed receipt persistence', () => {
    const sent = run('send', ':g Original question', { failSave: 2 })
    expect(sent.requests).toHaveLength(1)
    expect(sent.error).toBeDefined()
    const pending = meta(sent.draft.content).pending
    expect(pending.runId).toBeNull()
    expect(pending.request).toEqual(sent.requests[0].data)
    const recovered = run('send', waiting(sent.draft.content, ':c Future question'), {
      respond: (request) =>
        ok(
          request.url.includes('/operations/')
            ? { operationId: 'run-one' }
            : { engineId: 'geminiweb', runId: 'run-one', phase: 'running' },
        ),
    })
    expect(recovered.error).toBeUndefined()
    expect(recovered.requests.map((request) => request.method)).toEqual(['GET', 'GET'])
    expect(recovered.requests[0].url).toContain(pending.key)
    expect(meta(recovered.draft.content).pending.request).toEqual(pending.request)
    expect(recovered.draft.content).toContain(':c Future question')
  })

  it('refuses to recover or send a saved operation through another gateway', () => {
    const pending = run('send', ':g Original question').draft.content
    const credential = {
      create: () => ({
        ...draftsCredential.create(),
        getValue: (name) => (name === 'baseUrl' ? 'http://other-host:18080' : 'synthetic-token'),
      }),
    }
    for (const action of ['get', 'send']) {
      const result = run(action, pending, { credential })
      expect(result.error?.message).toContain('different gateway')
      expect(result.requests).toEqual([])
      expect(result.draft.content).toBe(pending)
    }
  })

  it('collects an actual pre-migration v3 pending fixture through common Get, retaining its original run and future reply', () => {
    const original = fs.readFileSync(
      new URL('./fixtures/drafts-gemini-pending.md', import.meta.url),
      'utf8',
    )
    const content = waiting(original, ':c Future reply stays with Gemini')
    const result = run('get', content, {
      respond: (request) => {
        expect(request.method).toBe('GET')
        expect(request.url).toContain('/runs/legacy-run')
        return ok({
          engineId: 'geminiweb',
          runId: 'legacy-run',
          phase: 'settled',
          outcome: 'completed',
          conversationRef: 'original-conversation',
          conversationRevision: 2,
          result: {
            version: 1,
            format: 'safe-html',
            content: '<p>Original answer</p>',
            metadata: { conversationId: 'c_abcdefgh', serverTurnId: 'original-turn' },
          },
        })
      },
    })
    expect(result.error).toBeUndefined()
    expect(result.requests).toHaveLength(1)
    expect(result.draft.content).toContain('Original Gemini question')
    expect(result.draft.content).toContain('Original answer')
    expect(result.draft.content).toContain(':c Future reply stays with Gemini')
    expect(meta(result.draft.content).pending).toBeUndefined()
    expect(meta(result.draft.content).engineId).toBe('geminiweb')
  })

  it.each(['c', 'g'])(
    'accepts a matching leading selector on a bound conversation without switching (%s)',
    (engine) => {
      const content = ':' + engine + ' ' + opened(engine)
      const result = run('get', content, {
        respond: () =>
          ok(
            engine === 'g'
              ? geminiDetail
              : { conversationId: 'thread-one', title: 'History', messages: [], pending: false },
          ),
      })
      expect(result.error).toBeUndefined()
      expect(result.requests).toHaveLength(1)
      expect(meta(result.draft.content).version).toBe(engine === 'g' ? 3 : 2)
    },
  )

  it('uses an ordinary body selector literally when there is no leading selector', () => {
    const query = 'Explain these examples:\n:g Do not select Gemini'
    const result = run('send', query)
    expect(result.error).toBeUndefined()
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].data.query).toBe(query)
    expect(result.requests[0].url).toContain('/chatgpt/conversations')
  })

  it('ships exactly the common generated scripts with stable identities and shared credentials', async () => {
    await expect(syncDraftsActions({ check: true })).resolves.toBeUndefined()
    const ids = new Set()
    for (const [name, source] of Object.entries(sources)) {
      const pkg = JSON.parse(
        fs.readFileSync(
          new URL('../docs/drafts/chatgptbox-' + name + '.draftsAction', import.meta.url),
          'utf8',
        ),
      )
      expect(pkg.steps).toHaveLength(1)
      expect(pkg.steps[0].data).toEqual({ script: source, allowAsync: 'false' })
      expect(pkg.disposition).toBe(0)
      expect(pkg.groupDisposition).toBe(0)
      expect(source).toContain("'ChatGPTBox Gateway'")
      expect(source).not.toContain('PASTE_GATEWAY_API_TOKEN_HERE')
      ids.add(pkg.uuid)
    }
    expect(ids.size).toBe(4)
  })
})
