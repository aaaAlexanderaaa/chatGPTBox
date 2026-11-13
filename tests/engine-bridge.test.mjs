import { describe, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { engineCaller, dispatchEngineRequest } from '../src/engines/browser-runtime.mjs'
import { forwardEngineBridgeFrame, observeEngineBridgeRun } from '../src/engines/bridge-client.mjs'
import { ENGINE_BRIDGE_PROTOCOL } from '../src/engines/contract.mjs'

const frame = {
  type: 'request',
  command: {
    protocol: ENGINE_BRIDGE_PROTOCOL,
    role: 'api',
    method: 'compat.completion',
    runId: 'original',
  },
}
describe('bridge trust and observation', () => {
  it('constructs external identities only in the actual extension bridge page', () => {
    const sender = { id: Browser.runtime.id, url: Browser.runtime.getURL('ApiServer.html') }
    expect(engineCaller(sender, { bridgeRole: 'mcp' })).toEqual({
      kind: 'api',
      principal: 'gateway-api',
    })
    expect(engineCaller(sender, { bridgeRole: 'mcp' })).toEqual(
      engineCaller(sender, { bridgeRole: 'api' }),
    )
    for (const bad of [
      { ...sender, id: 'another-extension' },
      { ...sender, url: 'https://chatgpt.com/' },
      { ...sender, url: Browser.runtime.getURL('Options.html') },
    ])
      expect(() => engineCaller(bad, { bridgeRole: 'api' })).toThrow(/bridge|runtime/)
  })
  it('rejects omitted or forged bridge roles before any execution service is constructed', async () => {
    for (const role of [undefined, 'extension', 'administrator'])
      await expect(
        dispatchEngineRequest(
          { ...frame.command, role },
          { id: Browser.runtime.id, tab: { id: 1 }, url: 'https://grok.com/' },
          { bridge: true },
        ),
      ).rejects.toMatchObject({ code: 'OPERATION_NOT_EXPOSED' })
  })
  it('waits with read-only messages and returns the common final body intact', async () => {
    let reads = 0
    const send = vi.fn(async ({ data }) => {
      expect(data.method).toBe('runs.read')
      expect(data.payload.runId).toBe('original')
      return {
        ok: true,
        value:
          ++reads === 1
            ? { runId: 'original', phase: 'running', preview: { content: 'Partial' } }
            : {
                runId: 'original',
                phase: 'settled',
                outcome: 'completed',
                result: { format: 'safe-html', content: '<p>Verified native final</p>' },
              },
      }
    })
    expect(
      await observeEngineBridgeRun(frame, { runId: 'original', phase: 'preparing' }, send, {
        delay: async () => {},
      }),
    ).toEqual({ runId: 'original', format: 'safe-html', answer: '<p>Verified native final</p>' })
    expect(send).toHaveBeenCalledTimes(2)
  })
  it.each(['unknown', 'incomplete', 'stopped'])(
    'does not publish %s or its preview as a successful completion',
    async (outcome) => {
      await expect(
        observeEngineBridgeRun(
          frame,
          {
            runId: 'original',
            phase: 'settled',
            submission: 'accepted',
            outcome,
            preview: { content: 'Partial' },
          },
          vi.fn(),
        ),
      ).rejects.toMatchObject({
        code: 'RESULT_UNCERTAIN',
        runId: 'original',
        submission: 'accepted',
      })
    },
  )
  it('rejects old private bridge frames without submitting an invocation', async () => {
    const send = vi.fn()
    await expect(
      forwardEngineBridgeFrame({ type: 'request', model: 'gpt-6-thinking' }, send),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', dispatched: false })
    expect(send).not.toHaveBeenCalled()
  })
})
