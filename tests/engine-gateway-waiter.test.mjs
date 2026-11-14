import { describe, expect, it, vi } from 'vitest'
import { waitForEngineRun } from '../scripts/lib/engine-gateway.mjs'

describe('generic MCP run observer', () => {
  it('observes an active recoverable run without competing with its live writer', async () => {
    let clock = 0,
      reads = 0
    const gateway = {
      start: vi.fn(),
      recover: vi.fn(),
      read: vi.fn(async () => {
        clock += 10
        return ++reads < 4
          ? {
              phase: reads === 1 ? 'preparing' : 'running',
              outcome: null,
              submission: 'possibly_submitted',
              resultAvailability: 'recoverable',
            }
          : {
              phase: 'settled',
              outcome: 'completed',
              submission: 'accepted',
              result: { content: 'Original final answer' },
            }
      }),
    }
    expect(
      await waitForEngineRun(gateway, {
        runId: 'original',
        now: () => clock,
        recoveryMs: 1,
        pollMs: 1,
        maxWaitMs: 1000,
      }),
    ).toMatchObject({ outcome: 'completed' })
    expect(gateway.recover).not.toHaveBeenCalled()
    expect(gateway.start).not.toHaveBeenCalled()
  })
  it('does not relabel an existing generation as unsent when a readonly observation is refused', async () => {
    const gateway = {
      start: vi.fn(),
      read: vi.fn(async () => {
        throw Object.assign(new Error('Read access changed'), {
          code: 'EXTERNAL_ACCESS_DISABLED',
          status: 403,
          retryable: false,
          submission: 'not_attempted',
        })
      }),
    }
    await expect(
      waitForEngineRun(gateway, { runId: 'original', maxWaitMs: 1000 }),
    ).rejects.toMatchObject({
      runId: 'original',
      code: 'EXTERNAL_ACCESS_DISABLED',
      submission: 'possibly_submitted',
    })
    expect(gateway.start).not.toHaveBeenCalled()
  })
  it('waits through a busy readonly recovery without starting another generation', async () => {
    let clock = 0
    const gateway = {
      start: vi.fn(),
      read: vi
        .fn()
        .mockImplementationOnce(async () => {
          clock = 10
          return {
            phase: 'settled',
            outcome: 'unknown',
            submission: 'accepted',
            resultAvailability: 'recoverable',
          }
        })
        .mockResolvedValue({
          phase: 'settled',
          outcome: 'completed',
          submission: 'accepted',
          result: { content: 'Exact original answer' },
        }),
      recover: vi.fn(async () => {
        throw Object.assign(new Error('Another writer is active'), {
          code: 'ENGINE_BUSY',
          status: 409,
          retryable: false,
          submission: 'not_attempted',
        })
      }),
    }
    expect(
      await waitForEngineRun(gateway, {
        runId: 'original',
        now: () => clock,
        recoveryMs: 1,
        pollMs: 1,
        maxWaitMs: 1000,
      }),
    ).toMatchObject({ outcome: 'completed' })
    expect(gateway.recover).toHaveBeenCalledTimes(1)
    expect(gateway.start).not.toHaveBeenCalled()
  })
  it('retries a transient readonly bridge outage without starting another run', async () => {
    const gateway = {
      start: vi.fn(),
      read: vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('Disconnected'), {
            code: 'BRIDGE_UNAVAILABLE',
            status: 503,
            retryable: false,
          }),
        )
        .mockResolvedValue({
          phase: 'settled',
          outcome: 'completed',
          result: { format: 'markdown', content: 'Verified final' },
        }),
      recover: vi.fn(),
    }
    const run = await waitForEngineRun(gateway, { runId: 'original', pollMs: 1, maxWaitMs: 1000 })
    expect(run.result.content).toBe('Verified final')
    expect(gateway.read).toHaveBeenCalledTimes(2)
    expect(gateway.start).not.toHaveBeenCalled()
  })
  it('does not turn completed metadata with an evicted body into success', async () => {
    const gateway = {
      read: vi.fn(async () => ({
        phase: 'settled',
        outcome: 'completed',
        resultAvailability: 'unavailable',
      })),
      start: vi.fn(),
    }
    await expect(
      waitForEngineRun(gateway, { runId: 'original', maxWaitMs: 1000 }),
    ).rejects.toMatchObject({ code: 'RESULT_UNAVAILABLE', runId: 'original', retryable: false })
    expect(gateway.start).not.toHaveBeenCalled()
  })
  it('detaches an aborted observation without cancelling or resubmitting upstream', async () => {
    const controller = new AbortController()
    const gateway = {
      read: vi.fn(async () => {
        controller.abort()
        throw new Error('Aborted')
      }),
      start: vi.fn(),
      cancel: vi.fn(),
    }
    await expect(
      waitForEngineRun(gateway, { runId: 'original', signal: controller.signal, maxWaitMs: 1000 }),
    ).rejects.toMatchObject({ runId: 'original', retryable: false })
    expect(gateway.start).not.toHaveBeenCalled()
    expect(gateway.cancel).not.toHaveBeenCalled()
  })
})
