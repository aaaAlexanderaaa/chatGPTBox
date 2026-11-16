import { describe, expect, it } from 'vitest'
import { createNativeEngineAdapters, nativeSessionReference } from '../src/engines/adapters.mjs'
import { EngineOperation as Op } from '../src/engines/contract.mjs'
import { switchSessionEngine } from '../src/services/session-binding.mjs'
import { createEngineRuntime } from '../src/engines/runtime.mjs'
import { createEngineStore } from '../src/engines/store.mjs'
import { createGeminiWebService } from '../src/background/gemini-web-service.mjs'
import { GEMINI_WEB_MODEL, GEMINI_WEB_SELECTION } from '../src/config/gemini-web.mjs'
import { buildChatgptWebConversationRequestBody } from '../src/services/clients/chatgpt-web/request-wire.mjs'

describe('ChatGPT native message identity', () => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  it.each([undefined, 'gateway-operation-id', 'c8ff9344-407e-4a29-8d08-5d87974cacde'])(
    'keeps run %s distinct from its valid native message identity',
    async (runId) => {
      const data = {},
        messages = [],
        recovered = []
      const config = { chatgptWebEnabled: true, disableWebModeHistory: true }
      const [adapter] = createNativeEngineAdapters({
        chatgptRecover: async (query) => {
          recovered.push(query)
          return { status: 'completed', text: 'Verified final' }
        },
        providers: {
          chatgptweb: {
            async run({ session, port }) {
              const body = buildChatgptWebConversationRequestBody({
                profile: 'codex-webview',
                question: session.question,
                messageId: session.messageId,
                model: session.chatgptWebModelSlugOverride,
              })
              messages.push(body.messages[0])
              // The native endpoint rejects opaque Box run IDs in this field.
              if (!uuidPattern.test(body.messages[0].id))
                throw new Error('Invalid conversation body')
              session.conversationId = 'controlled-conversation'
              session.parentMessageId = 'controlled-completed-head'
              port.postMessage({ accepted: true, session })
              port.postMessage({
                answer: 'Verified final',
                finalContent: 'Verified final',
                outcome: 'completed',
                done: true,
                session,
              })
            },
          },
        },
      })
      const runtime = createEngineRuntime({
        adapters: [adapter],
        store: createEngineStore({
          storage: {
            get: async (key) => ({ [key]: data[key] }),
            set: async (patch) => Object.assign(data, structuredClone(patch)),
          },
        }),
        getConfig: async () => config,
        setConfig: async (patch) => Object.assign(config, patch),
      })
      const caller = { kind: 'extension', principal: 'controlled' }
      const request = {
        contractVersion: 1,
        engineId: 'chatgptweb',
        operation: Op.Generate,
        modelId: 'gpt-6-thinking',
        input: { prompt: 'Improve the notice while preserving its meaning.' },
      }
      const receipt = await runtime.invoke(request, caller, runId ? { runId } : {})
      const result = await runtime.wait(receipt.runId, caller)
      expect(result).toMatchObject({ runId: receipt.runId, outcome: 'completed' })
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toMatch(uuidPattern)
      expect(result.result.metadata.messageId).toBe(messages[0].id)
      if (runId && uuidPattern.test(runId)) expect(messages[0].id).toBe(runId)
      else expect(messages[0].id).not.toBe(receipt.runId)
      await runtime.invoke(request, caller, { runId: receipt.runId })
      expect(messages).toHaveLength(1)
      const record = await runtime.privateRecord(receipt.runId, caller)
      await adapter.recover(record.nativeRef)
      expect(recovered).toEqual([
        { conversationId: 'controlled-conversation', messageId: messages[0].id },
      ])
    },
  )
})

describe('native engine UI selection', () => {
  it('passes the immutable common run ID to Gemini recovery rather than adopting a parent result', async () => {
    const data = {}
    const config = { apiServerEnabled: true, geminiWebEnabled: true, geminiWebReady: true }
    // A stale proof must be rejected before any website/storage read. No browser
    // APIs are supplied, so dropping the common context would also fail this test.
    const gemini = createGeminiWebService({ browser: {} })
    const adapters = createNativeEngineAdapters({
      geminiService: {
        ...gemini,
        reservations: async () => [],
        readConversation: async () => ({
          headCompleted: true,
          serverHead: 'server-A',
          responseId: 'response-A',
        }),
      },
      providers: { geminiweb: { run: async () => {} } },
    }).filter((adapter) => adapter.describe().id === 'geminiweb')
    const runtime = createEngineRuntime({
      adapters,
      store: createEngineStore({
        storage: {
          get: async (key) => ({ [key]: data[key] }),
          set: async (value) => Object.assign(data, structuredClone(value)),
        },
      }),
      getConfig: async () => config,
      setConfig: async (patch) => Object.assign(config, patch),
    })
    const caller = { kind: 'extension', principal: 'controlled' }
    const parent = nativeSessionReference({
      sessionId: 'history-parent',
      modelName: GEMINI_WEB_SELECTION,
      conversationId: 'c_abcdefgh',
      geminiWebRequestId: 'request-A',
      geminiWebServerTurnId: 'server-A',
      geminiWebResponseId: 'response-A',
      geminiWebOutputIdentity: {
        requestId: 'request-A',
        runId: 'run-A',
        conversationId: 'c_abcdefgh',
        serverTurnId: 'server-A',
        responseId: 'response-A',
      },
    })
    const binding = await runtime.importBinding('geminiweb', parent, caller)
    const receipt = await runtime.invoke(
      {
        contractVersion: 1,
        engineId: 'geminiweb',
        modelId: GEMINI_WEB_MODEL,
        operation: Op.Append,
        input: { prompt: 'Question B' },
        conversation: binding,
      },
      caller,
      { runId: 'run-B' },
    )
    expect(await runtime.wait(receipt.runId, caller)).toMatchObject({ outcome: 'unknown' })
    const recovered = await runtime.recover(receipt.runId, caller)
    expect(recovered).toMatchObject({ runId: 'run-B', outcome: 'unknown' })
    expect(recovered.result).toBeUndefined()
  })
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
      runId: `run-${crypto.randomUUID()}`,
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
    expect(sessions[1].parentMessageId).toBe('head-2')
    expect(sessions[1].messageId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(sessions[1].messageId).not.toBe(sessions[0].messageId)
  })
})
