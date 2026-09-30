/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const sendSource = fs.readFileSync(
  new URL('../docs/drafts/action-3-send-waiting-reply.js', import.meta.url),
  'utf8',
)
const getSource = fs.readFileSync(
  new URL('../docs/drafts/action-2-open-checked-conversation.js', import.meta.url),
  'utf8',
)
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
  return JSON.parse(content.match(/<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/)[1])
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
    expect(second.draft.content).toContain('Original question')
  })

  it('recovers an accepted original reply and preserves an edited question without resending it', () => {
    const first = run(note('Original question'), uncertain)
    const edited = first.draft.content.replace('\nOriginal question\n', '\nEdited question\n')
    const recovered = run(edited, completedConflict)
    expect(recovered.error).toBeUndefined()
    expect(recovered.requests).toHaveLength(1)
    expect(recovered.draft.content).toContain('### USER\n\nOriginal question')
    expect(recovered.draft.content).toContain(
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
    expect(failed.draft.content).toBe(edited)
    expect(metadata(failed.draft.content).operationId).toBe(
      metadata(first.draft.content).operationId,
    )
  })

  it('rejects a receipt belonging to another conversation', () => {
    const result = run(note('Edited question', { operationId: 'old' }), {
      ...completedConflict,
      responseData: {
        error: {
          ...completedConflict.responseData.error,
          operation_result: { ...receipt, conversationId: 'another-conversation' },
        },
      },
    })
    expect(result.error.message).toContain('another conversation')
    expect(metadata(result.draft.content).operationId).toBe('old')
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
    expect(result.draft.content).toContain('Edited question')
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
    expect(second.draft.content.trim()).toBe('Original question')
  })

  it('recovers a new-conversation receipt without losing the edited prompt', () => {
    const first = run('Original question', uncertain)
    const edited = first.draft.content.replace(/^Original question/, 'Edited question')
    const result = run(edited, completedConflict)
    expect(result.error).toBeUndefined()
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].data.query).toBe('Edited question')
    expect(result.draft.content).toContain('### USER\n\nOriginal question')
    expect(result.draft.content).toContain('\nEdited question\n<!-- chatgptbox-waiting-reply:end')
    expect(result.draft.content).not.toContain('chatgptbox-new-operation:')
  })
})
