/* eslint-env node */
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { GrokProxyControlAction, RuntimeMessage } from '../src/protocol/messages.mjs'
import { OperationLedger } from '../scripts/lib/operation-ledger.mjs'
import {
  isLegacyChatgptNotDispatchedOperation,
  respondChatgptNotDispatched,
} from '../scripts/lib/chatgpt-write-operations.mjs'

describe('ChatGPT unsent write recovery', () => {
  it('passes only proven unsent failures through both write controls', async () => {
    const source = fs.readFileSync(
      new URL('../src/background/message-router.mjs', import.meta.url),
      'utf8',
    )
    const start = source.indexOf('export function createMessageRouter()')
    let failure = Object.assign(new Error('Verification failed'), {
      chatgptWebNotDispatched: true,
      code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
    })
    const write = vi.fn(async () => {
      throw failure
    })
    const route = vm.runInNewContext(
      source.slice(start).replace('export function', 'function') + '\ncreateMessageRouter()',
      {
        RuntimeMessage,
        GrokProxyControlAction,
        createChatgptWebConversation: write,
        sendChatgptWebConversationMessageThroughProxy: write,
      },
    )
    for (const type of [
      RuntimeMessage.ChatgptWebCreateConversation,
      RuntimeMessage.ChatgptWebSendConversationMessage,
    ]) {
      expect(await route({ type, data: { query: 'hello' } })).toMatchObject({
        dispatched: false,
        code: failure.code,
        error: failure.message,
      })
      expect(write).toHaveBeenLastCalledWith({ query: 'hello' })
    }
    failure = new Error('Acknowledgement lost')
    await expect(route({ type: RuntimeMessage.ChatgptWebCreateConversation })).rejects.toThrow(
      'Acknowledgement lost',
    )
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
