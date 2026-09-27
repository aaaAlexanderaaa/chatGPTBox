import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export class GatewayError extends Error {
  constructor(message, { status, operationId, code, retryable } = {}) {
    super(message)
    this.status = status
    this.operationId = operationId
    this.code = code
    this.retryable = retryable
  }
}

export function createTurnCallLimiter(limit) {
  let active = 0
  return async (call) => {
    if (active >= limit) {
      const error = new Error(
        `ChatGPTBox MCP server allows at most ${limit} concurrent ChatGPT turns. No message was sent. Wait for an active turn to finish, then retry.`,
      )
      error.code = 'concurrency_limit'
      throw error
    }
    active++
    try {
      return await call()
    } finally {
      active--
    }
  }
}

export function createConversationGateway({ baseUrl, token, fetchImpl = fetch }) {
  async function request(
    path,
    { method = 'GET', body, idempotencyKey, signal, timeoutMs = 20_000 } = {},
  ) {
    const headers = { Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      throw new GatewayError(
        data?.error?.message || `API bridge returned HTTP ${response.status}`,
        {
          status: response.status,
          operationId: response.headers.get('x-operation-id'),
          code: data?.error?.code,
          retryable: data?.error?.retryable,
        },
      )
    }
    return data
  }

  return {
    create: (args, signal) =>
      request('/chatgpt/conversations', {
        method: 'POST',
        body: args,
        idempotencyKey: args.idempotency_key || crypto.randomUUID(),
        signal,
        timeoutMs: 65_000,
      }),
    turn: (conversationId, messageId, signal) =>
      request(
        `/chatgpt/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(
          messageId,
        )}`,
        { signal },
      ),
  }
}

export async function waitForFinalTurn(
  gateway,
  { conversationId, messageId, signal, onProgress, maxWaitMs = 45 * 60_000, pollMs = 10_000 },
) {
  const deadline = Date.now() + maxWaitMs
  let pollCount = 0
  let statusFailures = 0
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason || new Error('MCP request cancelled')
    try {
      const turn = await gateway.turn(conversationId, messageId, signal)
      statusFailures = 0
      if (turn?.status === 'completed' && typeof turn.text === 'string' && turn.text.trim()) {
        return turn
      }
      if (turn?.status === 'failed') {
        throw new GatewayError(turn.error || 'ChatGPT conversation failed', { status: 422 })
      }
    } catch (error) {
      if (error instanceof GatewayError && [404, 422].includes(error.status)) throw error
      statusFailures++
      if (statusFailures >= 3) throw error
    }
    pollCount++
    await onProgress?.(pollCount)
    await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())), undefined, { signal })
  }
  throw new GatewayError('Timed out waiting for the final ChatGPT answer')
}
