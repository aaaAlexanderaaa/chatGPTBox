import { describe, expect, it, vi } from 'vitest'
import { waitForEngineRun } from '../scripts/lib/engine-gateway.mjs'

describe('generic MCP run observer', () => {
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
