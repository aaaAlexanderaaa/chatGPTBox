/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

const sources = Object.fromEntries(
  ['list', 'get', 'send', 'older'].map((name) => [
    name,
    fs.readFileSync(new URL('../docs/drafts/gemini-' + name + '.js', import.meta.url), 'utf8'),
  ]),
)
const metadata = (content) =>
  JSON.parse(content.match(/^<!-- chatgptbox-document:(\{[^\n]*\}) -->/)[1])
const success = (data) => ({ success: true, statusCode: 200, responseData: data })
const detail = {
  conversationId: 'c_abcdefgh',
  conversationRef: 'conversation-native',
  conversationRevision: 3,
  serverHead: 'server-old',
  messages: [
    { role: 'user', content: 'Prior native question' },
    { role: 'assistant', content: '<p>Prior native answer</p>', completed: true, supported: true },
  ],
}
function run(action, content, respond, { failSave = false } = {}) {
  const requests = [],
    draft = {
      content,
      update: vi.fn(() => {
        if (failSave) throw new Error('Draft save failed')
      }),
    }
  const app = { displayErrorMessage: vi.fn(), displaySuccessMessage: vi.fn() }
  let error
  try {
    vm.runInNewContext(sources[action], {
      draft,
      app,
      HTTP: {
        create: () => ({
          request(req) {
            requests.push(JSON.parse(JSON.stringify(req)))
            return respond(req, draft)
          },
        }),
      },
    })
  } catch (e) {
    error = e
  }
  return { draft, requests, error, app }
}
function opened() {
  const list = run('list', '', () =>
    success({ items: [{ conversationRef: 'conversation-listed', title: 'Native history' }] }),
  )
  expect(list.error).toBeUndefined()
  const get = run('get', list.draft.content.replace('- [ ]', '- [x]'), () => success(detail))
  expect(get.error).toBeUndefined()
  return get.draft.content
}
function waiting(content, text) {
  const meta = metadata(content),
    start = '<!-- chatgptbox-' + meta.id + '-waiting:start -->',
    end = '<!-- chatgptbox-' + meta.id + '-waiting:end -->'
  return (
    content.slice(0, content.indexOf(start) + start.length) +
    '\n' +
    text +
    '\n' +
    content.slice(content.indexOf(end))
  )
}
const completed = {
  engineId: 'geminiweb',
  runId: 'run-one',
  phase: 'settled',
  outcome: 'completed',
  submission: 'accepted',
  resultAvailability: 'available',
  conversationRef: 'conversation-updated',
  conversationRevision: 4,
  result: {
    version: 1,
    format: 'safe-html',
    content: '<p>Exact verified answer</p>',
    metadata: { conversationId: 'c_abcdefgh', serverTurnId: 'server-new' },
  },
}

it('opens native history, durably freezes one explicit append, retains future text and adopts only its verified final result', () => {
  const first = run('send', waiting(opened(), '请核对上面的论证。'), (req, draft) => {
    expect(metadata(draft.content).pending.request).toEqual(req.data)
    expect(req.data).toMatchObject({
      operation: 'conversation.append',
      conversation: { ref: 'conversation-native', expectedRevision: 3 },
      input: { prompt: '请核对上面的论证。' },
    })
    return success({ engineId: 'geminiweb', runId: 'run-one' })
  })
  expect(first.error).toBeUndefined()
  expect(first.requests).toHaveLength(1)
  const edited = waiting(first.draft.content, '尚未发送的下一问')
  const partial = run('get', edited, () =>
    success({
      ...completed,
      outcome: null,
      phase: 'running',
      result: undefined,
      preview: { content: 'Unverified preview' },
    }),
  )
  expect(partial.draft.content).not.toContain('Unverified preview')
  expect(metadata(partial.draft.content).pending.runId).toBe('run-one')
  const final = run('get', partial.draft.content, () => success(completed))
  expect(final.error).toBeUndefined()
  expect(final.draft.content).toContain('Exact verified answer')
  expect(final.draft.content).toContain('尚未发送的下一问')
  expect(metadata(final.draft.content).pending).toBeUndefined()
  const next = run('send', final.draft.content, (req) => {
    expect(req.data.conversation).toEqual({ ref: 'conversation-updated', expectedRevision: 4 })
    return success({ engineId: 'geminiweb', runId: 'run-two' })
  })
  expect(next.error).toBeUndefined()
  expect(next.requests).toHaveLength(1)
})

it('recovers a lost receipt by its original key and run, without another POST or substituting edited text', () => {
  const first = run('send', 'Original independent question', () => ({
    success: false,
    statusCode: 0,
    error: 'Lost acknowledgement',
  }))
  expect(first.requests).toHaveLength(1)
  const original = metadata(first.draft.content).pending
  const recovery = run('send', waiting(first.draft.content, 'Edited future question'), (req) =>
    success(req.url.includes('/operations/') ? { operationId: 'run-one' } : completed),
  )
  expect(recovery.error).toBeUndefined()
  expect(recovery.requests.map((r) => r.method)).toEqual(['GET', 'GET'])
  expect(recovery.requests[0].url).toContain(encodeURIComponent(original.key))
  expect(recovery.draft.content).toContain('Original independent question')
  expect(recovery.draft.content).toContain('Edited future question')
})

it('releases only explicit unsent proof, preserves its text, and permits a later explicit independent send', () => {
  const refused = run('send', 'Retain this original question', () => ({
    success: false,
    statusCode: 403,
    responseData: { error: { submission: 'not_attempted', message: 'External access disabled' } },
  }))
  expect(refused.error).toBeDefined()
  expect(metadata(refused.draft.content).pending).toBeUndefined()
  expect(refused.draft.content).toContain('Retain this original question')
  const next = run('send', waiting(refused.draft.content, 'A deliberate new attempt'), (req) => {
    expect(req.data.operation).toBe('generation.start')
    return success({ engineId: 'geminiweb', runId: 'run-two' })
  })
  expect(next.error).toBeUndefined()
})

it('does not submit lists, old ChatGPT notes, damaged controls or an unpersisted request', () => {
  const listed = run('list', '', () =>
    success({ items: [{ conversationRef: 'conversation-one', title: 'One' }] }),
  ).draft.content
  for (const content of [
    listed,
    '<!-- chatgptbox-document:{"version":2,"id":"abcdefghijklmnop","kind":"conversation","controls":[]} -->\nOld ChatGPT note',
  ]) {
    const result = run('send', content, () => {
      throw new Error('No request allowed')
    })
    expect(result.requests).toHaveLength(0)
    expect(result.draft.content).toBe(content)
  }
  const content = opened(),
    meta = metadata(content)
  const damaged = content + '\n<!-- chatgptbox-' + meta.id + '-waiting:end -->'
  const result = run('send', damaged, () => {
    throw new Error('No request allowed')
  })
  expect(result.requests).toHaveLength(0)
  expect(result.draft.content).toBe(damaged)
  expect(
    run(
      'send',
      'Save must succeed',
      () => {
        throw new Error('No request allowed')
      },
      { failSave: true },
    ).requests,
  ).toHaveLength(0)
})

it('never discards an unresolved request when List is invoked on its conversation', () => {
  const pending = run('send', 'One uncertain question', () => ({
    success: false,
    statusCode: 0,
    error: 'Lost',
  })).draft.content
  const listed = run('list', pending, () => {
    throw new Error('No request allowed')
  })
  expect(listed.requests).toHaveLength(0)
  expect(listed.draft.content).toBe(pending)
})

it('preserves the transcript when a user renames the Waiting Reply heading', () => {
  const content = waiting(
    opened().replace('## Waiting Reply', '## My next question'),
    'Keep this next question',
  )
  const sent = run('send', content, () => success({ engineId: 'geminiweb', runId: 'run-one' }))
  expect(sent.error).toBeUndefined()
  expect(sent.draft.content).toContain('Prior native answer')
  expect(sent.draft.content).toContain('## My next question')
  expect(sent.draft.content).toContain('Keep this next question')
  const pending = sent.draft.content
  const wrong = run('get', pending, () => success({ ...completed, runId: 'unrelated-run' }))
  expect(wrong.error).toBeDefined()
  expect(wrong.draft.content).toBe(pending)
  expect(metadata(wrong.draft.content).pending.runId).toBe('run-one')
})

it('refreshes only the managed history and preserves notes outside it, including after a pending answer', () => {
  const base = waiting(opened(), 'Future question')
  const headerEnd = base.indexOf('\n') + 1
  const original =
    base.slice(0, headerEnd) + 'My introduction\n' + base.slice(headerEnd) + '\nMy footer note'
  const refreshed = run('get', original, () => success(detail))
  expect(refreshed.error).toBeUndefined()
  expect(refreshed.draft.content).toContain('My introduction')
  expect(refreshed.draft.content).toContain('My footer note')
  expect(refreshed.draft.content).toContain('Future question')
  const pending = run('send', refreshed.draft.content, () =>
    success({ engineId: 'geminiweb', runId: 'run-one' }),
  )
  const final = run('get', pending.draft.content, () => success(completed))
  expect(final.error).toBeUndefined()
  const latest = run('get', final.draft.content, () => success(detail))
  expect(latest.error).toBeUndefined()
  expect(latest.draft.content).toContain('My introduction')
  expect(latest.draft.content).toContain('My footer note')
  expect(latest.draft.content.match(/Prior native answer/g)).toHaveLength(1)
})

it('refuses to overwrite edits inside generated history or pending blocks', () => {
  const content = opened().replace('Prior native answer', 'My edited answer and notes')
  const edited = run('get', content, () => {
    throw new Error('No HTTP allowed')
  })
  expect(edited.requests).toHaveLength(0)
  expect(edited.error).toBeDefined()
  expect(edited.draft.content).toBe(content)
  const pending = run('send', 'Original question', () =>
    success({ engineId: 'geminiweb', runId: 'run-one' }),
  ).draft.content
  const annotated = pending.replace(
    'Use Gemini Get to collect this exact request.',
    'My notes inside pending',
  )
  const get = run('get', annotated, () => {
    throw new Error('No HTTP allowed')
  })
  expect(get.requests).toHaveLength(0)
  expect(get.error).toBeDefined()
  expect(get.draft.content).toBe(annotated)
})

it('loads older turns while preserving the current native head, recent text and unsent draft', () => {
  const listed = run('list', '', () =>
    success({ items: [{ conversationRef: 'conversation-one', title: 'History' }] }),
  ).draft.content.replace('- [ ]', '- [x]')
  const current = run('get', listed, () => success({ ...detail, nextCursor: 'older-page' }))
  const older = run('older', waiting(current.draft.content, 'Keep my draft'), (req) => {
    expect(req.url).toContain('&cursor=older-page')
    return success({
      ...detail,
      messages: [{ role: 'user', content: 'Earlier question' }],
      nextCursor: null,
    })
  })
  expect(older.error).toBeUndefined()
  expect(older.draft.content).toContain('Prior native answer')
  expect(older.draft.content).toContain('Earlier question')
  expect(older.draft.content).toContain('Keep my draft')
})

it('packages exactly the generated scripts without credentials or asynchronous runtime assumptions', () => {
  for (const [name, source] of Object.entries(sources)) {
    const pkg = JSON.parse(
      fs.readFileSync(
        new URL('../docs/drafts/chatgptbox-gemini-' + name + '.draftsAction', import.meta.url),
        'utf8',
      ),
    )
    expect(pkg.steps[0].data).toEqual({ script: source, allowAsync: 'false' })
    expect(source).toContain('PASTE_GATEWAY_API_TOKEN_HERE')
  }
})
