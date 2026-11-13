import { describe, expect, it } from 'vitest'
import { createNativeEngineAdapters, nativeSessionReference } from '../src/engines/adapters.mjs'
import { EngineOperation as Op } from '../src/engines/contract.mjs'
import { switchSessionEngine } from '../src/services/session-binding.mjs'

describe('native engine UI selection', () => {
  it('sends the newly selected ChatGPT model on the same conversation', async () => {
    const sessions = []
    const [adapter] = createNativeEngineAdapters({
      providers: {
        chatgptweb: {
          async run({ session, port }) {
            session.conversationId ||= 'controlled-conversation'
            session.parentMessageId = `head-${sessions.length + 1}`
            sessions.push(session)
            port.postMessage({ accepted: true, session })
            port.postMessage({
              answer: 'Verified answer',
              finalContent: 'Verified answer',
              outcome: 'completed',
              done: true,
              session,
            })
          },
        },
      },
    })
    const context = () => ({
      runId: crypto.randomUUID(),
      config: { disableWebModeHistory: true },
      report: async () => {},
      onCancel: () => () => {},
      isCancelled: () => false,
    })
    await adapter.generate(
      {
        engineId: 'chatgptweb',
        operation: Op.Generate,
        modelId: 'gpt-6-thinking',
        input: { prompt: 'Explain this argument' },
      },
      context(),
    )
    expect(adapter.fromLegacy(sessions[0]).modelId).toBe('gpt-6-thinking')
    const selected = switchSessionEngine(sessions[0], 'chatgptweb/gpt-6-pro')
    const request = { ...adapter.fromLegacy(selected), operation: Op.Append }
    await adapter.append(request, {
      ...context(),
      legacySession: selected,
      nativeRef: nativeSessionReference(sessions[0]),
    })
    expect(sessions.map((session) => session.chatgptWebModelSlugOverride)).toEqual([
      'gpt-6-thinking',
      'gpt-6-pro',
    ])
    expect(sessions[1].modelName).toBe('chatgptweb/gpt-6-pro')
    expect(sessions[1].conversationId).toBe(sessions[0].conversationId)
  })
})
