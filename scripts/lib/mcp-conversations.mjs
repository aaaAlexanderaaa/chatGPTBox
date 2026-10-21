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
    turn: (conversationId, messageId, signal, { recover = false } = {}) =>
      request(
        `/chatgpt/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(
          messageId,
        )}${recover ? '?recover=true' : ''}`,
        { signal },
      ),
  }
}

export async function waitForFinalTurn(
  gateway,
  {
    conversationId,
    messageId,
    signal,
    onProgress,
    maxWaitMs = 45 * 60_000,
    pollMs = 10_000,
    recoveryMs = 60_000,
  },
) {
  const deadline = Date.now() + maxWaitMs
  const waitSignal = AbortSignal.any([AbortSignal.timeout(maxWaitMs), ...(signal ? [signal] : [])])
  let pollCount = 0
  let lastRecoveryAt = Date.now()
  let lastReadError
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason || new Error('MCP request cancelled')
    try {
      let recover = Date.now() - lastRecoveryAt >= recoveryMs
      if (recover) lastRecoveryAt = Date.now()
      let turn
      try {
        turn = await gateway.turn(conversationId, messageId, waitSignal, { recover })
      } catch (error) {
        // A restarted worker can lose a local record. Inspect the acknowledged
        // turn once before treating it as missing; never replay the create.
        if (!(error instanceof GatewayError) || error.status !== 404 || recover) throw error
        recover = true
        lastRecoveryAt = Date.now()
        turn = await gateway.turn(conversationId, messageId, waitSignal, { recover })
      }
      lastReadError = null
      if (turn?.status === 'completed' && typeof turn.text === 'string' && turn.text.trim()) {
        return turn
      }
      if (turn?.status === 'failed') {
        throw new GatewayError(turn.error || 'ChatGPT conversation failed', { status: 422 })
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason || new Error('MCP request cancelled')
      if (
        error?.retryable === false ||
        (error instanceof GatewayError &&
          error.status < 500 &&
          ![408, 425, 429].includes(error.status))
      )
        throw error
      lastReadError = error
    }
    if (Date.now() >= deadline || waitSignal.aborted) break
    pollCount++
    // Progress delivery can remain pending after a transport interruption.
    // It must never block status reads or the original wait deadline.
    void Promise.resolve()
      .then(() => onProgress?.(pollCount))
      .catch(() => {})
    try {
      await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())), undefined, {
        signal: waitSignal,
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error
      if (!waitSignal.aborted) throw error
    }
  }
  throw new GatewayError(
    `Timed out waiting for the final ChatGPT answer${
      lastReadError ? `; last status check: ${lastReadError.message}` : ''
    }`,
    { code: 'turn_wait_timeout', retryable: false },
  )
}
