import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export function createEngineGateway({ baseUrl, token, fetchImpl = fetch }) {
  async function request(path, { body, signal, key } = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(65000), ...(signal ? [signal] : [])]),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok)
      throw Object.assign(
        new Error(data?.error?.message || `Engine gateway returned HTTP ${response.status}`),
        data?.error,
        {
          status: response.status,
          runId: data?.runId || data?.error?.runId || response.headers.get('x-operation-id'),
        },
      )
    return data
  }
  return {
    engines: (signal) => request('/engines', { signal }),
    start: (engineId, input, signal, key = crypto.randomUUID()) =>
      request(`/engines/${encodeURIComponent(engineId)}/runs`, {
        body: {
          contractVersion: 1,
          engineId,
          operation: 'generation.start',
          input: { prompt: input.prompt },
          ...(input.modelId ? { modelId: input.modelId } : {}),
          ...(input.extensions ? { extensions: input.extensions } : {}),
        },
        signal,
        key,
      }),
    read: (runId, signal) => request(`/runs/${encodeURIComponent(runId)}`, { signal }),
    recover: (runId, signal) =>
      request(`/runs/${encodeURIComponent(runId)}/recover`, { body: {}, signal }),
  }
}

// Polling and readonly recovery never call start. An MCP cancellation detaches
// this wait; it is not evidence that the remote engine cancelled its work.
export async function waitForEngineRun(
  gateway,
  {
    runId,
    signal,
    maxWaitMs = 2700000,
    pollMs = 10000,
    recoveryMs = 60000,
    onProgress,
    now = Date.now,
  },
) {
  const deadline = now() + maxWaitMs
  const waitSignal = AbortSignal.any([AbortSignal.timeout(maxWaitMs), ...(signal ? [signal] : [])])
  let lastRecoveryAt = now(),
    recoverySupported = true,
    progress = 0,
    lastError
  while (now() < deadline && !waitSignal.aborted) {
    try {
      let run = await gateway.read(runId, waitSignal)
      if (
        recoverySupported &&
        now() - lastRecoveryAt >= recoveryMs &&
        !run.result &&
        (run.resultAvailability === 'recoverable' || run.outcome === 'unknown')
      ) {
        lastRecoveryAt = now()
        try {
          run = await gateway.recover(runId, waitSignal)
        } catch (error) {
          if (error.code === 'OPERATION_NOT_IMPLEMENTED') recoverySupported = false
          else throw error
        }
      }
      if (run.phase === 'settled') {
        if (run.outcome === 'completed' && run.result?.content?.trim()) return run
        if (
          run.outcome === 'completed' &&
          run.resultAvailability === 'recoverable' &&
          recoverySupported
        ) {
          run = await gateway.recover(runId, waitSignal)
          lastRecoveryAt = now()
          if (run.outcome === 'completed' && run.result?.content?.trim()) return run
        }
        if (
          run.outcome !== 'unknown' ||
          !recoverySupported ||
          run.resultAvailability !== 'recoverable'
        )
          throw Object.assign(
            new Error(
              run.error?.message ||
                `Engine run ended as ${run.outcome}; inspect the original run before creating another.`,
            ),
            {
              code:
                run.outcome === 'completed'
                  ? 'RESULT_UNAVAILABLE'
                  : run.error?.code || 'RESULT_UNCERTAIN',
              runId,
              retryable: false,
              submission: run.submission,
              outcome: run.outcome,
            },
          )
      }
      lastError = null
    } catch (error) {
      if (signal?.aborted)
        throw Object.assign(
          new Error('MCP observation cancelled; the original engine run may continue.'),
          { runId, retryable: false },
        )
      if (
        (error.code !== 'BRIDGE_UNAVAILABLE' && error.retryable === false) ||
        (error.status && error.status < 500 && ![408, 429].includes(error.status))
      )
        throw error
      lastError = error
    }
    void Promise.resolve()
      .then(() => onProgress?.(++progress))
      .catch(() => {})
    try {
      await delay(Math.min(pollMs, Math.max(0, deadline - now())), undefined, {
        signal: waitSignal,
      })
    } catch (error) {
      if (signal?.aborted) throw Object.assign(error, { runId, retryable: false })
    }
  }
  throw Object.assign(
    new Error(
      `Timed out observing engine run${
        lastError ? `: ${lastError.message}` : ''
      }; read the same run to continue.`,
    ),
    { code: 'RUN_WAIT_TIMEOUT', runId, retryable: false },
  )
}
