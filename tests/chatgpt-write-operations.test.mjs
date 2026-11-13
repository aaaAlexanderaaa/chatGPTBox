import { createLegacyEngineControls } from '../src/engines/legacy-controls.mjs'
/* eslint-env node */
import { describe, expect, it, vi } from 'vitest'
import { RuntimeMessage } from '../src/protocol/messages.mjs'
import { OperationLedger } from '../scripts/lib/operation-ledger.mjs'
import {
  isLegacyChatgptNotDispatchedOperation,
  respondChatgptNotDispatched,
} from '../scripts/lib/chatgpt-write-operations.mjs'

describe('ChatGPT unsent write recovery', () => {
  it('projects only a proven unsent common run through both legacy write controls', async () => {
    const invoke = vi.fn(async () => ({ runId: 'run' }))
    const service = {
      invoke,
      wait: async () => ({
        submission: 'not_attempted',
        error: { code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED', message: 'Verification failed' },
      }),
      privateBindings: async () => [
        { ref: 'ref', revision: 1, nativeRef: { session: { conversationId: 'conversation' } } },
      ],
    }
    const control = createLegacyEngineControls({
      service,
      adapters: [
        {
          describe: () => ({ id: 'chatgptweb' }),
          fromLegacyControl: () => ({
            request: {
              engineId: 'chatgptweb',
              operation: 'generation.start',
              input: { prompt: 'hello' },
            },
            session: {},
          }),
        },
      ],
      getConfig: async () => ({}),
    })
    for (const type of [
      RuntimeMessage.ChatgptWebCreateConversation,
      RuntimeMessage.ChatgptWebSendConversationMessage,
    ]) {
      expect(
        await control(
          { type, data: { conversationId: 'conversation' } },
          { kind: 'api', principal: 'gateway-api' },
        ),
      ).toMatchObject({
        dispatched: false,
        code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
        error: 'Verification failed',
      })
    }
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1][0]).toMatchObject({
      operation: 'conversation.append',
      conversation: { ref: 'ref', expectedRevision: 1 },
    })
  })
  it('releases a proven unsent write so an edited request can use the same key', () => {
    const ledger = new OperationLedger()
    const operation = ledger.begin({ key: 'draft', fingerprint: 'original' }).record
    const res = { writeHead: vi.fn(), end: vi.fn() }
    expect(
      respondChatgptNotDispatched(res, ledger, operation, {
        dispatched: false,
        error: 'Runtime verification failed',
        code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
      }),
    ).toBe(true)
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
      error: { dispatched: false, retryable: false },
    })
    expect(ledger.begin({ key: 'draft', fingerprint: 'edited' }).kind).toBe('new')
  })

  it('keeps unknown failures protected against an edited request', () => {
    const ledger = new OperationLedger()
    const operation = ledger.begin({ key: 'draft', fingerprint: 'original' }).record
    const res = { writeHead: vi.fn(), end: vi.fn() }
    for (const result of [undefined, { error: 'timeout' }, { dispatched: true }]) {
      expect(respondChatgptNotDispatched(res, ledger, operation, result)).toBe(false)
    }
    expect(res.end).not.toHaveBeenCalled()
    expect(ledger.begin({ key: 'draft', fingerprint: 'edited' }).kind).toBe('conflict')
  })

  it('recognizes only the exact historical pre-transport failure', () => {
    const error =
      'The loaded ChatGPT page runtime is not supported. Refresh the proxy tab and check for a ChatGPTBox protocol update.'
    expect(isLegacyChatgptNotDispatchedOperation({ state: 'ambiguous', error })).toBe(true)
    expect(
      isLegacyChatgptNotDispatchedOperation({
        state: 'ambiguous',
        error: 'Uncaught Error: ' + error,
      }),
    ).toBe(true)
    for (const record of [
      { state: 'completed', error },
      { state: 'dispatching', error },
      { state: 'ambiguous', error: 'Uncaught Error: [delta] unknown delta encoding: "v1"' },
      { state: 'ambiguous', error: 'Timed out waiting for conversation reply acknowledgement' },
      { state: 'ambiguous', error: error + ' after sending' },
    ]) {
      expect(isLegacyChatgptNotDispatchedOperation(record)).toBe(false)
    }
  })
})
