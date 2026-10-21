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

  it('checks the existing conversation once before reporting a missing turn', async () => {
    const turn = vi
      .fn()
      .mockRejectedValue(
        new GatewayError('No local turn status matches these IDs', { status: 404 }),
      )
    await expect(
      waitForFinalTurn({ turn }, { conversationId: 'c1', messageId: 'm1', pollMs: 1 }),
    ).rejects.toThrow('No local turn status matches these IDs')
    expect(turn).toHaveBeenCalledTimes(2)
    expect(turn.mock.calls[1][3]).toEqual({ recover: true })
  })

  it('recovers a completed turn after its local running record stopped updating', async () => {
    const turn = vi.fn(async (_conversationId, _messageId, _signal, { recover }) =>
      recover
        ? { status: 'completed', text: 'Recovered final answer' }
        : { status: 'running', text: 'Partial answer' },
    )
    const answer = await waitForFinalTurn(
      { turn },
      { conversationId: 'c1', messageId: 'm1', pollMs: 1, recoveryMs: 5, maxWaitMs: 1000 },
    )
    expect(answer.text).toBe('Recovered final answer')
    expect(turn.mock.calls[0][3]).toEqual({ recover: false })
    expect(turn.mock.calls.at(-1)[3]).toEqual({ recover: true })
  })

  it('survives more than three bridge failures and resumes reading the same turn', async () => {
    const turn = vi.fn()
    for (let index = 0; index < 5; index++) {
      turn.mockRejectedValueOnce(new GatewayError('Bridge reconnecting', { status: 503 }))
    }
    turn.mockResolvedValueOnce({ status: 'completed', text: 'Finished while disconnected' })
    const answer = await waitForFinalTurn(
      { turn },
      { conversationId: 'c1', messageId: 'm1', pollMs: 1 },
    )
    expect(answer.text).toBe('Finished while disconnected')
    expect(turn).toHaveBeenCalledTimes(6)
    expect(
      turn.mock.calls.every(
        ([conversationId, messageId]) => conversationId === 'c1' && messageId === 'm1',
      ),
    ).toBe(true)
  })

  it('keeps the original wait deadline when a status HTTP request stalls', async () => {
    const turn = vi.fn(
      (_conversationId, _messageId, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    await expect(
      waitForFinalTurn(
        { turn },
        {
          conversationId: 'c1',
          messageId: 'm1',
          maxWaitMs: 20,
          pollMs: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'turn_wait_timeout' })
    expect(turn).toHaveBeenCalledTimes(1)
  })

  it('honors cancellation during a disconnected-bridge retry', async () => {
    const controller = new AbortController()
    const reason = new Error('User cancelled the MCP call')
    const turn = vi.fn(async () => {
      controller.abort(reason)
      throw new GatewayError('Bridge disconnected', { status: 503 })
    })
    await expect(
      waitForFinalTurn(
        { turn },
        {
          conversationId: 'c1',
          messageId: 'm1',
          signal: controller.signal,
          pollMs: 1,
        },
      ),
    ).rejects.toBe(reason)
    expect(turn).toHaveBeenCalledTimes(1)
  })

  it('returns the completed answer even when a progress notification never settles', async () => {
    const turn = vi
      .fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'completed', text: 'Finished while progress was stuck' })
    const onProgress = vi.fn(() => new Promise(() => {}))
    await expect(
      waitForFinalTurn(
        { turn },
        {
          conversationId: 'c1',
          messageId: 'm1',
          pollMs: 1,
          maxWaitMs: 100,
          onProgress,
        },
      ),
    ).resolves.toMatchObject({ text: 'Finished while progress was stuck' })
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(turn).toHaveBeenCalledTimes(2)
  })

  it('does not retry authentication failures or lose answers on progress delivery errors', async () => {
    const turn = vi.fn().mockRejectedValue(new GatewayError('Unauthorized', { status: 401 }))
    await expect(
      waitForFinalTurn(
        { turn },
        {
          conversationId: 'c1',
          messageId: 'm1',
          pollMs: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 401 })
    expect(turn).toHaveBeenCalledTimes(1)

    turn
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'completed', text: 'Final' })
    await expect(
      waitForFinalTurn(
        { turn },
        {
          conversationId: 'c1',
          messageId: 'm1',
          pollMs: 1,
          onProgress: async () => {
            throw new Error('Progress connection lost')
          },
        },
      ),
    ).resolves.toMatchObject({ text: 'Final' })
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
    await gateway.turn('c1', 'm1', undefined, { recover: true })
    expect(fetchImpl.mock.calls[2][0]).toBe(
      'http://127.0.0.1:18080/chatgpt/conversations/c1/turns/m1?recover=true',
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
