/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { formatChatgptWebConversationSnapshot } from '../src/services/clients/chatgpt-web/conversation-state.mjs'
import { clientWidgetMessage, staticComponentsMessage } from './fixtures/genui-components.mjs'

const sendSource = fs.readFileSync(
  new URL('../docs/drafts/action-3-send-waiting-reply.js', import.meta.url),
  'utf8',
)
const getSource = fs.readFileSync(
  new URL('../docs/drafts/action-2-open-checked-conversation.js', import.meta.url),
  'utf8',
)
const listSource = fs.readFileSync(
  new URL('../docs/drafts/action-1-list-conversations.js', import.meta.url),
  'utf8',
)

function visible(content) {
  return content
    .replace(/^<!-- chatgptbox-document:.* -->\n?/, '')
    .replace(/chatgptbox-[a-z0-9]{16,80}-/g, 'chatgptbox-')
}
const receipt = {
  conversationId: 'conversation-1',
  messageId: 'original-message',
  query: 'Original question',
  createdAt: '2026-09-30T04:00:00Z',
  pending: true,
}
const note = (query, metadata = {}) =>
  [
    '# Conversation',
    'Conversation ID: conversation-1',
    '## Waiting Reply',
    '<!-- chatgptbox-waiting-reply:start ' +
      JSON.stringify({ conversationId: 'conversation-1', ...metadata }) +
      ' -->',
    query,
    '<!-- chatgptbox-waiting-reply:end -->',
  ].join('\n')

function run(content, response, { override, source = sendSource } = {}) {
  const requests = []
  const draft = { content, update: vi.fn() }
  const app = { displayErrorMessage: vi.fn(), displaySuccessMessage: vi.fn() }
  let error
  try {
    vm.runInNewContext(
      override
        ? source.replace('const MODEL_OVERRIDE = null', `const MODEL_OVERRIDE = '${override}'`)
        : source,
      {
        draft,
        app,
        HTTP: {
          create: () => ({
            request(request) {
              requests.push(JSON.parse(JSON.stringify(request)))
              return response
            },
          }),
        },
      },
    )
  } catch (caught) {
    error = caught
  }
  return { draft, requests, error, app }
}
function metadata(content) {
  return JSON.parse(visible(content).match(/<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/)[1])
}
const uncertain = {
  success: false,
  statusCode: 409,
  responseData: { error: { code: 'ambiguous_dispatch', message: 'Acknowledgement lost' } },
}
const completedConflict = {
  success: false,
  statusCode: 409,
  responseData: {
    error: {
      code: 'idempotency_key_conflict',
      operation_state: 'completed',
      operation_result: receipt,
    },
  },
}

describe('Drafts operation recovery', () => {
  it('does not send or rewrite a generated conversation list when Send is run on it', () => {
    const listed = run(
      '',
      {
        success: true,
        statusCode: 200,
        responseData: {
          items: [
            { id: 'thread-1', title: 'First' },
            { id: 'thread-2', title: 'Second' },
          ],
        },
      },
      { source: listSource },
    )
    expect(listed.error).toBeUndefined()
    const content = listed.draft.content
    const result = run(content, { success: true, statusCode: 200, responseData: receipt })
    expect(result.requests).toHaveLength(0)
    expect(result.error?.message).toContain('Use Get')
    expect(result.draft.content).toBe(content)
  })

  it('keeps a recognizable legacy list as a list without sending its conversation controls', () => {
    const content = '- [x] First | date <!-- chatgptbox-conversation:thread-1 -->'
    const result = run(content, { success: true, statusCode: 200, responseData: receipt })
    expect(result.requests).toHaveLength(0)
    expect(result.error?.message).toContain('Use Get')
    expect(visible(result.draft.content)).toBe(content)
    expect(result.draft.content).not.toContain('new-operation:')
  })

  it.each(['new', 'follow-up'])(
    'recovers a %s text send when its question contains a literal conversation-control name',
    (kind) => {
      const query = 'Explain the literal text -conversation: in this example.'
      const first = run(kind === 'new' ? query : note(query), uncertain)
      expect(first.requests).toHaveLength(1)
      const retried = run(first.draft.content, uncertain)
      expect(retried.requests).toHaveLength(1)
      expect(retried.requests[0].headers['Idempotency-Key']).toBe(
        first.requests[0].headers['Idempotency-Key'],
      )
      expect(retried.requests[0].data).toEqual(first.requests[0].data)
      expect(retried.error?.message).toBe('Acknowledgement lost')
    },
  )

  it.each([
    ['registered components', staticComponentsMessage],
    ['client widget', clientWidgetMessage],
  ])('keeps mixed component content in Get transcript text (%s)', (_, fixture) => {
    const message = fixture()
    const conversation = formatChatgptWebConversationSnapshot({
      conversation_id: 'conversation-1',
      current_node: message.id,
      messages: [
        {
          id: 'original-message',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Component demonstration'] },
        },
        message,
      ],
    })
    const result = run(
      'Conversation ID: conversation-1',
      {
        success: true,
        statusCode: 200,
        responseData: conversation,
      },
      { source: getSource },
    )
    expect(result.error).toBeUndefined()
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].method).toBe('GET')
    expect(visible(result.draft.content)).toContain(conversation.messages[1].text)
    expect(visible(result.draft.content)).toContain('<pre ')
    expect(visible(result.draft.content)).toContain('console.log(value);')
    expect(visible(result.draft.content)).toContain('Sample subject')
    expect(visible(result.draft.content)).toContain('End of component demonstration')
  })

  it('preserves the exact original request when only model settings change after an uncertain result', () => {
    const first = run(note('Original question'), uncertain, { override: 'gpt-6-pro' })
    const second = run(
      first.draft.content,
      { success: true, statusCode: 200, responseData: receipt },
      { override: 'gpt-5-6-thinking' },
    )
    expect(second.error).toBeUndefined()
    expect(second.requests[0].headers['Idempotency-Key']).toBe(
      first.requests[0].headers['Idempotency-Key'],
    )
    expect(second.requests[0].data).toEqual(first.requests[0].data)
    expect(metadata(second.draft.content).operationId).toBeUndefined()
  })

  it('clears only the proven unsent operation while keeping the question', () => {
    const first = run(note('Original question'), uncertain)
    const operationId = metadata(first.draft.content).operationId
    const second = run(first.draft.content, {
      success: false,
      statusCode: 503,
      responseData: { error: { message: 'Verification failed', dispatched: false } },
    })
    expect(second.error.message).toBe('Verification failed')
    expect(second.requests).toHaveLength(1)
    expect(second.requests[0].headers['Idempotency-Key']).toBe(operationId)
    expect(metadata(second.draft.content).operationId).toBeUndefined()
    expect(metadata(second.draft.content).operationRequest).toBeUndefined()
    expect(visible(second.draft.content)).toContain('Original question')
  })

  it('recovers an accepted original reply and preserves an edited question without resending it', () => {
    const first = run(note('Original question'), uncertain)
    const edited = first.draft.content.replace('\nOriginal question\n', '\nEdited question\n')
    const recovered = run(edited, completedConflict)
    expect(recovered.error).toBeUndefined()
    expect(recovered.requests).toHaveLength(1)
    expect(visible(recovered.draft.content)).toContain('### USER\n\nOriginal question')
    expect(visible(recovered.draft.content)).toContain(
      '\nEdited question\n<!-- chatgptbox-waiting-reply:end',
    )
    expect(metadata(recovered.draft.content)).toMatchObject({ pendingMessageId: receipt.messageId })
    expect(metadata(recovered.draft.content).operationId).toBeUndefined()
  })

  it('keeps an ambiguous old operation and edited text without minting a second send', () => {
    const first = run(note('Original question'), uncertain)
    const edited = first.draft.content.replace('\nOriginal question\n', '\nEdited question\n')
    const failed = run(edited, {
      success: false,
      statusCode: 409,
      responseData: { error: { code: 'idempotency_key_conflict', operation_state: 'ambiguous' } },
    })
    expect(failed.error.message).toContain('result is not confirmed')
    expect(failed.requests).toHaveLength(1)
    expect(visible(failed.draft.content)).toBe(visible(edited))
    expect(metadata(failed.draft.content).operationId).toBe(
      metadata(first.draft.content).operationId,
    )
  })

  it('rejects a receipt belonging to another conversation', () => {
    const result = run(
      note('Edited question', {
        operationId: 'drafts-' + Date.now().toString(36) + '-receipt',
        operationRequest: { query: 'Original question' },
      }),
      {
        ...completedConflict,
        responseData: {
          error: {
            ...completedConflict.responseData.error,
            operation_result: { ...receipt, conversationId: 'another-conversation' },
          },
        },
      },
    )
    expect(result.error.message).toContain('another conversation')
    expect(metadata(result.draft.content).operationId).toMatch(/^drafts-/)
  })

  it('preserves a saved request across Get and keeps edited text', () => {
    const request = { query: 'Original question', think: false, model: 'gpt-6-pro' }
    const result = run(
      note('Edited question', { operationId: 'old', operationRequest: request }),
      {
        success: true,
        statusCode: 200,
        responseData: {
          conversationId: 'conversation-1',
          title: 'Title',
          messages: [],
          pending: false,
        },
      },
      { source: getSource },
    )
    expect(result.error).toBeUndefined()
    expect(metadata(result.draft.content)).toMatchObject({
      operationId: 'old',
      operationRequest: request,
    })
    expect(visible(result.draft.content)).toContain('Edited question')
  })

  it('also freezes settings for new conversations and removes their marker after an unsent failure', () => {
    const first = run('Original question', uncertain, { override: 'gpt-6-pro' })
    const second = run(
      first.draft.content,
      {
        success: false,
        statusCode: 503,
        responseData: { error: { message: 'Unsent', dispatched: false } },
      },
      { override: 'gpt-5-6-thinking' },
    )
    expect(second.requests[0].data).toEqual(first.requests[0].data)
    expect(visible(second.draft.content).trim()).toBe('Original question')
  })

  it('recovers a new-conversation receipt without losing the edited prompt', () => {
    const first = run('Original question', uncertain)
    const edited = first.draft.content.replace(/\nOriginal question\n/, '\nEdited question\n')
    const result = run(edited, completedConflict)
    expect(result.error).toBeUndefined()
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].data.query).toBe('Original question')
    expect(visible(result.draft.content)).toContain('### USER\n\nOriginal question')
    expect(visible(result.draft.content)).toContain(
      '\nEdited question\n<!-- chatgptbox-waiting-reply:end',
    )
    expect(visible(result.draft.content)).not.toContain('chatgptbox-new-operation:')
  })
})

it('treats transcript control examples as text through Get and Send, and rejects duplicate bound controls', () => {
  const example =
    '```markdown\n<!-- chatgptbox-waiting-reply:start {"conversationId":"wrong-thread"} -->\nexample query\n<!-- chatgptbox-waiting-reply:end -->\n```\n- [x] example <!-- chatgptbox-conversation:wrong-thread -->\nPhoto send: ordinary quoted text'
  const fetched = run(
    'Conversation ID: conversation-1',
    {
      success: true,
      statusCode: 200,
      responseData: {
        conversationId: 'conversation-1',
        title: 'Title',
        messages: [{ role: 'assistant', text: example, isFinal: true }],
        pending: false,
      },
    },
    { source: getSource },
  )
  expect(fetched.error).toBeUndefined()
  expect(fetched.draft.content).toContain(example)
  const header = JSON.parse(fetched.draft.content.match(/^<!-- chatgptbox-document:(.*) -->/)[1])
  const end = `<!-- chatgptbox-${header.id}-waiting-reply:end -->`
  const edited = fetched.draft.content.replace(end, 'Real next question\n' + end)
  const sent = run(edited, { success: true, statusCode: 200, responseData: receipt })
  expect(sent.error).toBeUndefined()
  expect(sent.requests).toHaveLength(1)
  expect(sent.requests[0].url).toContain('/conversation-1/messages')
  expect(sent.requests[0].data.query).toBe('Real next question')
  const duplicate = edited + '\n' + header.controls[0]
  const refused = run(duplicate, { success: true, responseData: receipt })
  expect(refused.requests).toEqual([])
  expect(refused.draft.content).toBe(duplicate)
})
it('rejects a fenced legacy-looking example before any network request or content change', () => {
  const content =
    '# Please explain this example\n```markdown\n## Waiting Reply\n<!-- chatgptbox-waiting-reply:start {"conversationId":"unintended-thread"} -->\nexample question\n<!-- chatgptbox-waiting-reply:end -->\n```'
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.draft.content).toBe(content)
})
it('retains an uncertain operation when the ledger becomes unavailable', () => {
  const first = run(note('Original question'), uncertain)
  const key = metadata(first.draft.content).operationId
  const result = run(first.draft.content, {
    success: false,
    statusCode: 503,
    responseData: {
      error: {
        code: 'operation_ledger_unavailable',
        message: 'Protection cannot be read',
        retryable: false,
      },
    },
  })
  expect(metadata(result.draft.content).operationId).toBe(key)
})
it('keeps a legacy pending question intact when Send refresh cannot yet find its message', () => {
  const content =
    '# Conversation\n\nConversation ID: conversation-1\n\n### USER\n\nOnly local copy\n\n### ASSISTANT (pending)\n\n## Waiting Reply\n\n<!-- chatgptbox-waiting-reply:start {"conversationId":"conversation-1","pendingMessageId":"unseen"} -->\n<!-- chatgptbox-waiting-reply:end -->'
  const result = run(content, {
    success: true,
    statusCode: 200,
    responseData: { conversationId: 'conversation-1', messages: [], pending: false },
  })
  expect(result.error.message).toContain('not visible yet')
  expect(result.draft.content).toContain('Only local copy')
  expect(metadata(result.draft.content).pendingMessageId).toBe('unseen')
})

it.each([
  'new-operation:oldkey {"query":"original"}',
  'photo-operation:{"id":"oldkey","request":{"query":"original"}}',
])('rejects damaged legacy %s without minting a replacement send', (marker) => {
  const content = 'Original question\n\n<!-- chatgptbox-' + marker + ' --'
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.draft.content).toBe(content)
})

it('rejects incomplete v2 openers with the current document identity', () => {
  const first = run(note('Original question'), uncertain)
  const id = JSON.parse(first.draft.content.match(/^<!-- chatgptbox-document:(.*) -->/)[1]).id
  const content = first.draft.content + '\n<!-- chatgptbox-' + id + '-new-operation:damaged --'
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.draft.content).toBe(content)
})
it.each([
  '<!-- chatgptbox-waiting-reply:end junk -->',
  '<!-- chatgptbox-new-operation:garbage -->',
  '```markdown <!-- chatgptbox-new-operation:garbage -->',
])('rejects malformed complete legacy control %s', (marker) => {
  const content = 'Original question\n' + marker
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.draft.content).toBe(content)
})

it('preserves comment-ending text in the saved request without breaking control syntax', () => {
  const question = 'Explain the arrow --> without losing its text.'
  const result = run(question, uncertain)
  expect(result.requests).toHaveLength(1)
  expect(result.requests[0].data.query).toBe(question)
  const retry = run(result.draft.content, uncertain)
  expect(retry.requests[0].data.query).toBe(question)
  expect(retry.requests[0].headers['Idempotency-Key']).toBe(
    result.requests[0].headers['Idempotency-Key'],
  )
})

it.each(['new', 'follow-up'])(
  'replays the frozen %s request after editing even if the gateway never recorded the first attempt',
  (kind) => {
    const first = run(kind === 'new' ? 'Original question' : note('Original question'), uncertain)
    const edited = first.draft.content.replace(/(^|\n)Original question\n/, '$1Edited question\n')
    const replay = run(edited, { success: true, statusCode: 200, responseData: receipt })
    expect(replay.error).toBeUndefined()
    expect(replay.requests[0].headers['Idempotency-Key']).toBe(
      first.requests[0].headers['Idempotency-Key'],
    )
    expect(replay.requests[0].data).toEqual(first.requests[0].data)
    expect(visible(replay.draft.content)).toContain('### USER\n\nOriginal question')
    expect(visible(replay.draft.content)).toContain(
      '\nEdited question\n<!-- chatgptbox-waiting-reply:end',
    )
  },
)
it('Get retains an unresolved operation after its editable question is cleared', () => {
  const first = run(note('Original question'), uncertain)
  const emptied = first.draft.content.replace('\nOriginal question\n', '\n\n')
  const result = run(
    emptied,
    {
      success: true,
      statusCode: 200,
      responseData: { conversationId: 'conversation-1', messages: [], pending: false },
    },
    { source: getSource },
  )
  expect(result.error).toBeUndefined()
  expect(metadata(result.draft.content).operationId).toBe(metadata(first.draft.content).operationId)
  expect(metadata(result.draft.content).operationRequest).toEqual(first.requests[0].data)
  const send = run(result.draft.content, { success: true, responseData: receipt })
  expect(send.requests).toEqual([])
  expect(metadata(send.draft.content).operationId).toBe(metadata(first.draft.content).operationId)
})
it('does not complete a missing-identity repeat using an older same-text turn', () => {
  const content = note('', { pendingQuery: 'repeat', pendingSentAt: '2026-11-09T12:00:00Z' })
  const result = run(
    content,
    {
      success: true,
      statusCode: 200,
      responseData: {
        conversationId: 'conversation-1',
        pending: false,
        messages: [
          { role: 'user', messageId: 'old', text: 'repeat' },
          { role: 'assistant', text: 'old answer', isFinal: true },
        ],
      },
    },
    { source: getSource },
  )
  expect(result.error).toBeUndefined()
  expect(metadata(result.draft.content).pendingQuery).toBe('repeat')
  expect(visible(result.draft.content)).toContain('Status: pending')
})
it('does not complete an anchored turn with another client’s later assistant reply', () => {
  const result = run(
    note('', { pendingMessageId: 'ours', pendingQuery: 'our question' }),
    {
      success: true,
      statusCode: 200,
      responseData: {
        conversationId: 'conversation-1',
        pending: false,
        messages: [
          { role: 'user', messageId: 'ours', text: 'our question' },
          { role: 'user', messageId: 'other', text: 'other question' },
          { role: 'assistant', text: 'their answer', isFinal: true },
        ],
      },
    },
    { source: getSource },
  )
  expect(result.error).toBeUndefined()
  expect(metadata(result.draft.content).pendingMessageId).toBe('ours')
})
it('keeps the next question without a second write while an acknowledged turn is pending', () => {
  const content = note('Next question', {
    pendingMessageId: 'ours',
    pendingQuery: 'Original question',
  })
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.error.message).toContain('still pending')
  expect(visible(result.draft.content)).toContain('Next question')
  expect(metadata(result.draft.content).pendingMessageId).toBe('ours')
})
it.each([
  'photos:{"images":[],"pendingPhotos":[],"projectId":"unexpected-project"}',
  'new-operation:drafts-' + Date.now().toString(36) + '-example {"query":"example"}',
])('does not migrate a standalone legacy control in prose (%s)', (marker) => {
  const content = 'Please explain this control example.\n\n<!-- chatgptbox-' + marker + ' -->'
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.draft.content).toBe(content)
})
it('rejects a legacy photo control quoted inside a conversation transcript', () => {
  const content = note('Next question').replace(
    '## Waiting Reply',
    '### ASSISTANT\n<!-- chatgptbox-photos:{"images":[],"projectId":"unexpected-project"} -->\n\n## Waiting Reply',
  )
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.draft.content).toBe(content)
})
it('keeps a legacy pending note intact when only a send time survives', () => {
  const content = note('', { pendingSentAt: '2026-11-09T12:00:00Z' }).replace(
    '## Waiting Reply',
    '### USER\nOnly local copy\n\n## Waiting Reply',
  )
  const result = run(
    content,
    {
      success: true,
      statusCode: 200,
      responseData: { conversationId: 'conversation-1', messages: [], pending: false },
    },
    { source: getSource },
  )
  expect(result.error.message).toContain('not visible yet')
  expect(result.draft.content).toContain('Only local copy')
  expect(metadata(result.draft.content).pendingSentAt).toBe('2026-11-09T12:00:00Z')
})
it('does not mint a replacement when an existing operation id is damaged', () => {
  const content = note('Question', {
    operationId: '',
    operationRequest: { query: 'Original question' },
  })
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.error).toBeDefined()
  expect(metadata(result.draft.content).operationId).toBe('')
  expect(metadata(result.draft.content).operationRequest.query).toBe('Original question')
})
it('retains a valid saved key without dispatch when its original request is missing', () => {
  const id = 'drafts-' + Date.now().toString(36) + '-missingrequest'
  const result = run(note('Edited question', { operationId: id }), {
    success: true,
    responseData: receipt,
  })
  expect(result.requests).toEqual([])
  expect(result.error.message).toContain('saved send request is missing')
  expect(metadata(result.draft.content).operationId).toBe(id)
})
it('Get keeps the complete legacy note when an operation and another pending message coexist', () => {
  const content = note('Edited question', {
    operationId: 'drafts-' + Date.now().toString(36) + '-original',
    operationRequest: { query: 'Original send' },
    pendingMessageId: 'previous-message',
    pendingQuery: 'Previous question',
  })
  const result = run(
    content,
    {
      success: true,
      responseData: { conversationId: 'conversation-1', messages: [], pending: false },
    },
    { source: getSource },
  )
  expect(result.requests).toEqual([])
  expect(result.error).toBeDefined()
  expect(visible(result.draft.content)).toBe(content)
})
function appendManagedControl(content, name, data) {
  const header = JSON.parse(content.match(/^<!-- chatgptbox-document:(.*) -->/)[1])
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const marker = '<!-- chatgptbox-' + header.id + '-' + name + ':' + json(data) + ' -->'
  const body = content.replace(/^<!-- chatgptbox-document:.* -->\n?/, '') + '\n' + marker + '\n'
  header.controls.push(marker)
  return '<!-- chatgptbox-document:' + json(header) + ' -->\n' + body
}
it('recovers the original new-text operation after photos were appended after its marker', () => {
  const first = run('Original question', uncertain)
  const edited = first.draft.content.replace(/(^|\n)Original question\n/, '$1Edited question\n')
  const withPhotos = appendManagedControl(edited, 'photos', {
    images: [{ id: 'img-next-photo', name: 'next.jpg' }],
    pendingPhotos: [],
  })
  const recovered = run(withPhotos, { success: true, statusCode: 200, responseData: receipt })
  expect(recovered.error).toBeUndefined()
  expect(recovered.requests).toHaveLength(1)
  expect(recovered.requests[0].headers['Idempotency-Key']).toBe(
    first.requests[0].headers['Idempotency-Key'],
  )
  expect(recovered.requests[0].data).toEqual(first.requests[0].data)
  expect(recovered.requests[0].data.attachments).toBeUndefined()
  expect(visible(recovered.draft.content)).toContain(
    '\nEdited question\n<!-- chatgptbox-waiting-reply:end',
  )
  expect(visible(recovered.draft.content)).toContain('img-next-photo')
})
it.each([sendSource, getSource])(
  'rejects simultaneous text and photo operations before any request',
  (source) => {
    const first = run('Original question', uncertain)
    const content = appendManagedControl(first.draft.content, 'photo-operation', {
      id: 'photo-key',
      request: { query: 'another write' },
    })
    const result = run(content, { success: true, responseData: receipt }, { source })
    expect(result.requests).toEqual([])
    expect(result.draft.content).toBe(content)
  },
)
it('Send shares Get’s rejection of an operation key and a pending message identity', () => {
  const content = note('Edited question', {
    operationId: 'drafts-' + Date.now().toString(36) + '-original',
    operationRequest: { query: 'Original send' },
    pendingMessageId: 'previous-message',
  })
  const result = run(content, { success: true, responseData: receipt })
  expect(result.requests).toEqual([])
  expect(result.draft.content).toBe(content)
})
