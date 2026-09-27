/* eslint-env node */
import { describe, expect, it, vi } from 'vitest'
import {
  createConversationGateway,
  createTurnCallLimiter,
  GatewayError,
  waitForFinalTurn,
} from '../scripts/lib/mcp-conversations.mjs'

describe('MCP conversation wait', () => {
  it('rejects a fifth active turn before dispatch and releases slots after completion', async () => {
    const withTurnSlot = createTurnCallLimiter(4)
    const releases = []
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          releases.push(resolve)
        }),
    )
    const active = Array.from({ length: 4 }, () => withTurnSlot(send))
    expect(send).toHaveBeenCalledTimes(4)
    await expect(withTurnSlot(send)).rejects.toMatchObject({
      code: 'concurrency_limit',
      message: expect.stringContaining('No message was sent'),
    })
    expect(send).toHaveBeenCalledTimes(4)

    releases[0]('done')
    await expect(active[0]).resolves.toBe('done')
    const next = withTurnSlot(send)
    expect(send).toHaveBeenCalledTimes(5)
    releases.slice(1).forEach((release) => release('done'))
    await Promise.all([...active.slice(1), next])
  })

  it('waits past interim text and returns only a completed turn', async () => {
    const turn = vi
      .fn()
      .mockResolvedValueOnce({ status: 'running', text: 'thinking' })
      .mockResolvedValueOnce({ status: 'running', text: 'draft' })
      .mockResolvedValueOnce({ status: 'completed', text: 'final answer' })
    const gateway = { turn }
    const progress = vi.fn()
    const result = await waitForFinalTurn(gateway, {
      conversationId: 'c1',
      messageId: 'm1',
      pollMs: 1,
      onProgress: progress,
    })
    expect(result.text).toBe('final answer')
    expect(turn).toHaveBeenCalledTimes(3)
    expect(progress).toHaveBeenCalledTimes(2)
  })

  it('stops on a recorded failure without retrying the write', async () => {
    const turn = vi.fn().mockResolvedValue({ status: 'failed', error: 'upstream rejected request' })
    await expect(
      waitForFinalTurn({ turn }, { conversationId: 'c1', messageId: 'm1', pollMs: 1 }),
    ).rejects.toThrow('upstream rejected request')
    expect(turn).toHaveBeenCalledTimes(1)
  })

  it('reports a missing local turn immediately without repeating the status lookup', async () => {
    const turn = vi
      .fn()
      .mockRejectedValue(
        new GatewayError('No local turn status matches these IDs', { status: 404 }),
      )
    await expect(
      waitForFinalTurn({ turn }, { conversationId: 'c1', messageId: 'm1', pollMs: 1 }),
    ).rejects.toThrow('No local turn status matches these IDs')
    expect(turn).toHaveBeenCalledTimes(1)
  })

  it('preserves the status and guidance code from a missing-turn response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({
        error: {
          code: 'turn_status_not_found',
          message: 'Check the IDs from the acknowledgement',
          retryable: false,
        },
      }),
    })
    const gateway = createConversationGateway({ baseUrl: 'http://x', token: 't', fetchImpl })
    await expect(gateway.turn('c1', 'm1')).rejects.toMatchObject({
      status: 404,
      code: 'turn_status_not_found',
      retryable: false,
      message: 'Check the IDs from the acknowledgement',
    })
  })

  it('keeps the API token on the bridge request and idempotency key on the write', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversationId: 'c1', messageId: 'm1' }),
    })
    const gateway = createConversationGateway({
      baseUrl: 'http://127.0.0.1:18080',
      token: 'api-secret',
      fetchImpl,
    })
    await gateway.create({ query: 'research', idempotency_key: 'stable-key' })
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer api-secret',
      'Idempotency-Key': 'stable-key',
    })
    await gateway.turn('c1', 'm1')
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'http://127.0.0.1:18080/chatgpt/conversations/c1/turns/m1',
    )
  })

  it('reports an ambiguous operation id without retrying a dispatched write', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => 'operation-123' },
      json: async () => ({ error: { message: 'ambiguous dispatch' } }),
    })
    const gateway = createConversationGateway({ baseUrl: 'http://x', token: 't', fetchImpl })
    await expect(gateway.create({ query: 'research' })).rejects.toMatchObject({
      operationId: 'operation-123',
      status: 409,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(GatewayError).toBeDefined()
  })
})
