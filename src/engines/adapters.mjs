// Browser-only adapters. Existing native transports remain the sole writers.
import chatgptProvider from '../background/providers/chatgpt-web.mjs'
import grokProvider from '../background/providers/grok-web.mjs'
import geminiProvider from '../background/providers/gemini-web.mjs'
import {
  getChatgptWebConversationWithFallback,
  listChatgptWebConversationsWithFallback,
  listChatgptWebModelsWithFallback,
  recoverChatgptWebTurnStatus,
  uploadChatgptWebImagesViaProxy,
  listChatgptWebProjectsViaProxy,
  syncChatgptWebConversationCacheWithFallback,
} from '../background/chatgpt-proxy-service.mjs'
import { executeGrokWebControlRequest } from '../background/grok-proxy-service.mjs'
import { geminiWebService } from '../background/gemini-web-service.mjs'
import { GrokProxyControlAction, isProviderAdmissionMessage } from '../protocol/messages.mjs'
import { WEB_ENGINE_DEFINITIONS } from './catalog.mjs'
import { validateEngineShape } from './schema.mjs'
import {
  EngineError,
  EngineOperation as Op,
  assertKnownFields,
  serializeEngineError,
} from './contract.mjs'
import { initSession } from '../services/init-session.mjs'
import { setUserConfig } from '../config/storage.mjs'
import { getSelectionString, parseEngineSelection } from '../config/engine-selection.mjs'
import {
  CHATGPT_WEB_DEFAULT_MODEL_SLUG,
  CHATGPT_WEB_DEFAULT_THINKING_EFFORT,
} from '../config/limits.mjs'
import { GEMINI_WEB_MODEL } from '../config/gemini-web.mjs'
import { Models } from '../config/models.mjs'
import { isGrokChatSlug, pickDefaultGrokWebKey } from '../config/grok-web.mjs'
import {
  getChatgptWebThinkingEffortOverride,
  isChatgptWebThinkingEffort,
  needsChatgptWebThinkingEffort,
} from '../services/clients/chatgpt-web/thinking.mjs'
import { validateChatgptImagePointer } from '../services/clients/chatgpt-web/image-content.mjs'
import { deleteConversation, sendMessageFeedback } from '../services/apis/chatgpt-web'
import { getChatGptAccessToken } from '../services/wrappers.mjs'
import {
  findStoredChatgptWebApiThreadContinuation,
  saveChatgptWebApiThread,
  saveChatgptWebSessionSnapshot,
} from '../services/clients/chatgpt-web/thread-state.mjs'
import {
  upsertChatgptWebCreatedConversationIndexEntry,
  updateChatgptWebConversationTurnIndex,
} from '../services/clients/chatgpt-web/conversation-cache.mjs'

const SESSION_REFERENCE_FIELDS = [
  'sessionId',
  'modelName',
  'chatgptWebModelSlugOverride',
  'remoteBindingGeneration',
  'conversationId',
  'messageId',
  'parentMessageId',
  'wsRequestId',
  'previousResponseID',
  'geminiWebTabId',
  'geminiWebOwnerId',
  'geminiWebDocumentId',
  'geminiWebLastNativeId',
  'geminiWebServerTurnId',
  'geminiWebResponseId',
  'geminiWebResponseTimestamp',
  'geminiWebRequestId',
  'geminiWebOutputIdentity',
  'geminiWebUrl',
  'chatgptWebProjectId',
  'engineAccountSalt',
  'engineAccountFingerprint',
]

export function nativeSessionReference(session) {
  const fields = Object.fromEntries(
    SESSION_REFERENCE_FIELDS.filter((key) => session[key] != null).map((key) => [
      key,
      session[key],
    ]),
  )
  if (!fields.conversationId && !fields.geminiWebTabId) return null
  return {
    session: fields,
    head:
      fields.geminiWebServerTurnId ||
      fields.geminiWebLastNativeId ||
      fields.previousResponseID ||
      fields.parentMessageId ||
      null,
  }
}

function outputFormat(engineId, session) {
  return engineId === 'geminiweb' || session.chatgptWebRendering?.format === 'html'
    ? 'safe-html'
    : 'markdown'
}

export async function runNativeProvider(provider, definition, session, context, onPacket) {
  const listeners = new Set(),
    disconnects = new Set()
  let terminal,
    latestAnswer = '',
    latestSession = session,
    accepted = false,
    lastReference = ''
  const report = (event) => {
    void context.report(event).catch(() => {})
  }
  const port = {
    _isClosed: false,
    get __stopRequested() {
      return context.isCancelled()
    },
    onMessage: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
    onDisconnect: {
      addListener: (listener) => disconnects.add(listener),
      removeListener: (listener) => disconnects.delete(listener),
    },
    postMessage(packet) {
      if (packet.session) latestSession = { ...latestSession, ...packet.session }
      onPacket?.(packet, latestSession)
      const nativeRef = nativeSessionReference(latestSession)
      const referenceSignature = JSON.stringify(nativeRef)
      if (nativeRef && referenceSignature !== lastReference) {
        lastReference = referenceSignature
        report({ type: 'reference', nativeRef })
      }
      if (!accepted && isProviderAdmissionMessage(packet)) {
        accepted = true
        report({
          type: 'accepted',
          evidence: { kind: packet.accepted ? 'provider-acceptance' : 'correlated-output' },
          nativeRef,
        })
      }
      if (typeof packet.answer === 'string' && packet.answer) {
        latestAnswer = packet.answer
        report({
          type: 'preview',
          output: {
            version: 1,
            format: outputFormat(definition.id, latestSession),
            content: latestAnswer,
          },
        })
      }
      if (packet.error) {
        const submission = packet.dispatched === false ? 'not_attempted' : 'possibly_submitted'
        terminal = {
          outcome: submission === 'not_attempted' ? 'failed' : 'unknown',
          submission,
          error: serializeEngineError(new Error(packet.error), { submission }),
          nativeRef,
        }
      } else if (packet.done) {
        const final = typeof packet.finalContent === 'string' ? packet.finalContent : latestAnswer
        terminal = {
          outcome: packet.outcome || 'unknown',
          submission: accepted ? 'accepted' : 'possibly_submitted',
          nativeRef,
          ...(packet.outcome === 'completed' && final
            ? {
                finalOutput: {
                  version: 1,
                  format: outputFormat(definition.id, latestSession),
                  content: final,
                  metadata: {
                    conversationId: latestSession.conversationId || null,
                    messageId: latestSession.messageId || context.runId,
                    ...(definition.id === 'geminiweb'
                      ? {
                          serverTurnId: latestSession.geminiWebServerTurnId || null,
                          responseId: latestSession.geminiWebResponseId || null,
                          responseTimestamp: latestSession.geminiWebResponseTimestamp || null,
                        }
                      : {}),
                    thoughtDurationSec:
                      latestSession.chatgptWebResponseDiagnostics?.reasoningDurationSeconds ?? null,
                  },
                },
              }
            : {}),
          ...(latestAnswer
            ? {
                partialOutput: {
                  version: 1,
                  format: outputFormat(definition.id, latestSession),
                  content: latestAnswer,
                },
              }
            : {}),
        }
      } else report({ type: 'progress', packet })
    },
    disconnect() {
      if (this._isClosed) return
      this._isClosed = true
      for (const listener of disconnects) listener()
    },
  }
  const removeCancel = context.onCancel(() => {
    for (const listener of listeners) listener({ stop: true })
  })
  try {
    await provider.run({ session, port, config: context.config })
  } catch (error) {
    if (!terminal) throw error
  } finally {
    removeCancel()
  }
  context.legacySessionResult = latestSession
  if (!terminal)
    terminal = {
      outcome: context.isCancelled() ? 'stopped' : 'unknown',
      submission: 'possibly_submitted',
      nativeRef: nativeSessionReference(latestSession),
    }
  return terminal
}

function sessionFor(request, context) {
  const old = context.legacySession || {}
  const binding = request.operation === Op.Append ? context.nativeRef?.session || {} : {}
  const session = {
    ...initSession({
      question: request.input.prompt,
      modelName: `${request.engineId}/${request.modelId}`,
    }),
    ...old,
    ...binding,
    question: request.input.prompt,
    modelName: `${request.engineId}/${request.modelId}`,
    apiMode: null,
    messageId: context.runId,
  }
  if (request.operation === Op.Generate) {
    for (const key of SESSION_REFERENCE_FIELDS)
      if (!['sessionId', 'modelName', 'remoteBindingGeneration'].includes(key)) delete session[key]
    session.messageId = context.runId
  }
  return session
}

export function createNativeEngineAdapters(deps = {}) {
  const definitions = deps.definitions || WEB_ENGINE_DEFINITIONS
  const providers = deps.providers || {
    chatgptweb: chatgptProvider,
    grokweb: grokProvider,
    geminiweb: geminiProvider,
  }
  const chatgptRead = deps.chatgptRead || getChatgptWebConversationWithFallback
  const grokControl = deps.grokControl || executeGrokWebControlRequest
  const gemini = deps.geminiService || geminiWebService
  const now = deps.now || Date.now
  const catalog = (items, source, checkedAt = null) => ({
    items: items.map((id) => ({ id })),
    source,
    checkedAt,
    expiresAt: checkedAt ? checkedAt + 300000 : null,
    availability: checkedAt ? 'observed' : 'unknown',
  })
  return definitions.map((definition) => {
    const adapter = {
      describe: () => definition,
      configureCompletion(converted, config) {
        converted.session.autoClean = false
        if (definition.id === 'chatgptweb') {
          converted.session.chatgptWebIncrementalOutput = false
          converted.session.chatgptWebHistoryDisabledOverride = config.apiServerKeepHistory !== true
          converted.request.extensions.chatgptweb.historyDisabled =
            config.apiServerKeepHistory !== true
        }
      },
      async findLegacyContinuation(payload) {
        if (
          definition.id !== 'chatgptweb' ||
          !needsChatgptWebThinkingEffort(payload.model) ||
          payload.images?.length ||
          payload.projectId
        )
          return null
        return findStoredChatgptWebApiThreadContinuation(payload).catch(() => null)
      },
      referenceForContinuation(value, modelId) {
        return nativeSessionReference({
          sessionId: `legacy-${globalThis.crypto.randomUUID()}`,
          modelName: `${definition.id}/${modelId}`,
          conversationId: value.conversationId,
          parentMessageId: value.parentMessageId,
        })
      },
      async rememberLegacyCompletion(payload, answer, session) {
        if (
          definition.id === 'chatgptweb' &&
          needsChatgptWebThinkingEffort(payload.model) &&
          !payload.images?.length &&
          !payload.projectId &&
          session?.conversationId
        )
          await saveChatgptWebApiThread({
            model: payload.model,
            messages: payload.messages,
            answer,
            session,
          }).catch(() => {})
      },
      fromLegacyControl(payload, config) {
        const prompt = payload.query || payload.message || payload.raw || ''
        const chosen = payload.model || payload.modelSlug
        const modelId = chosen
          ? chosen.replace(`${definition.id}/`, '')
          : definition.id === 'chatgptweb'
          ? CHATGPT_WEB_DEFAULT_MODEL_SLUG
          : definition.id === 'geminiweb'
          ? GEMINI_WEB_MODEL
          : Models[pickDefaultGrokWebKey(config.grokWebAccountTier)]?.value
        const session = initSession({
          question: prompt,
          modelName: `${definition.id}/${modelId}`,
          autoClean: false,
        })
        if (definition.id === 'chatgptweb') {
          session.chatgptWebThinkingEffortOverride = getChatgptWebThinkingEffortOverride(payload)
          session.chatgptWebHistoryDisabledOverride = false
          session.chatgptWebProjectId = payload.projectId || null
          session.chatgptWebImagePointers = payload.images || []
          session.chatgptWebImagePointers.forEach(validateChatgptImagePointer)
        }
        return { request: adapter.fromLegacy(session), session }
      },
      referenceFromHistory(detail, modelId) {
        if (
          !detail?.conversationId ||
          (definition.id === 'chatgptweb' &&
            (detail.cache?.source !== 'network' || detail.cache?.stale || !detail.currentNode))
        )
          throw new EngineError(
            'CONTEXT_UNAVAILABLE',
            'The original conversation could not be freshly verified.',
          )
        const session = {
          sessionId:
            definition.id === 'geminiweb'
              ? `history-gemini-${detail.conversationId}`
              : `legacy-${globalThis.crypto.randomUUID()}`,
          modelName: `${definition.id}/${modelId || detail.defaultModel || ''}`,
          conversationId: detail.conversationId,
          ...(definition.id === 'chatgptweb'
            ? { parentMessageId: detail.currentNode, chatgptWebProjectId: detail.projectId || null }
            : definition.id === 'geminiweb'
            ? {
                modelName: `geminiweb/${modelId || GEMINI_WEB_MODEL}`,
                geminiWebServerTurnId: detail.serverHead,
                geminiWebResponseId: detail.responseId,
              }
            : { previousResponseID: detail.previousResponseID }),
        }
        return nativeSessionReference(session)
      },
      fromLegacy(session) {
        const selected = parseEngineSelection(getSelectionString(session))
        return {
          contractVersion: 1,
          engineId: definition.id,
          operation: Op.Generate,
          modelId: session.chatgptWebModelSlugOverride || selected?.modelId,
          input: { prompt: session.question },
          ...(definition.id === 'chatgptweb'
            ? {
                parameters: session.chatgptWebThinkingEffortOverride
                  ? { thinkingEffort: session.chatgptWebThinkingEffortOverride }
                  : {},
                extensions: {
                  chatgptweb: {
                    ...(session.chatgptWebProjectId
                      ? { projectId: session.chatgptWebProjectId }
                      : {}),
                    ...(typeof session.chatgptWebHistoryDisabledOverride === 'boolean'
                      ? { historyDisabled: session.chatgptWebHistoryDisabledOverride }
                      : {}),
                  },
                },
              }
            : {}),
        }
      },
      resolveModel(request, config) {
        if (request.modelId) return request.modelId
        if (request.operation === Op.Append) return undefined // runtime resolves the original binding
        if (definition.id === 'chatgptweb') return CHATGPT_WEB_DEFAULT_MODEL_SLUG
        if (definition.id === 'geminiweb') return GEMINI_WEB_MODEL
        return Models[pickDefaultGrokWebKey(config.grokWebAccountTier)]?.value
      },
      validate(request) {
        validateEngineShape(request.input, definition.inputSchema)
        validateEngineShape(request.parameters || {}, definition.parameterSchema, 'parameters')
        validateEngineShape(request.extensions || {}, definition.extensionSchema, 'extensions')
        assertKnownFields(request.parameters || {}, ['thinkingEffort'], 'parameters')
        assertKnownFields(request.extensions || {}, [definition.id], 'extensions')
        const effort = request.parameters?.thinkingEffort
        if (definition.id === 'chatgptweb') {
          if (effort !== undefined && !isChatgptWebThinkingEffort(effort))
            throw new EngineError('PARAMETER_UNSUPPORTED', 'Unsupported ChatGPT thinking effort.')
          assertKnownFields(
            request.extensions?.chatgptweb || {},
            ['projectId', 'historyDisabled'],
            'ChatGPT options',
          )
        } else {
          if (request.input.attachments?.length)
            throw new EngineError(
              'INPUT_UNSUPPORTED',
              `${definition.label} does not support attachments in this adapter.`,
            )
          if (
            request.extensions?.[definition.id] &&
            Object.keys(request.extensions[definition.id]).length
          )
            throw new EngineError(
              'PARAMETER_UNSUPPORTED',
              'This adapter has no provider-specific request options.',
            )
          if (definition.id === 'geminiweb') {
            if (
              request.modelId !== GEMINI_WEB_MODEL ||
              (effort !== undefined && effort !== 'medium')
            )
              throw new EngineError(
                'PARAMETER_UNSUPPORTED',
                'Gemini Web supports 4 Hydrogen / Medium only.',
              )
            if (request.input.prompt.length > 50000)
              throw new EngineError(
                'INPUT_UNSUPPORTED',
                'Gemini accepts at most 50,000 prompt characters.',
              )
          } else if (!isGrokChatSlug(request.modelId) || effort !== undefined)
            throw new EngineError(
              'PARAMETER_UNSUPPORTED',
              'Choose an available Grok model without a thinking effort override.',
            )
        }
      },
      async prepare(request, context) {
        if (request.operation !== Op.Append) return
        const original = context.nativeRef?.session
        if (!original)
          throw new EngineError(
            'CONTEXT_UNAVAILABLE',
            'The original native binding is unavailable.',
          )
        if (!context.nativeRef.head && definition.id !== 'geminiweb')
          throw new EngineError(
            'CONTEXT_UNAVAILABLE',
            'Read and verify the original conversation head before appending.',
          )
        if (definition.id === 'chatgptweb') {
          const detail = await chatgptRead({
            conversationId: original.conversationId,
            forceRefresh: true,
            latestOnly: true,
            requestTimeoutMs: 10000,
          })
          if (
            detail?.conversationId !== original.conversationId ||
            detail.cache?.source !== 'network' ||
            detail.cache?.stale ||
            !detail.currentNode
          )
            throw new EngineError(
              'CONTEXT_UNAVAILABLE',
              'The current ChatGPT head could not be freshly verified.',
            )
          if (context.nativeRef.head && detail.currentNode !== context.nativeRef.head)
            throw new EngineError(
              'BINDING_CHANGED',
              'The native ChatGPT conversation changed. Inspect it before appending.',
            )
          const project = request.extensions?.chatgptweb?.projectId
          if (project && project !== detail.projectId)
            throw new EngineError(
              'BINDING_CHANGED',
              'The original conversation does not belong to the selected Project.',
            )
          original.parentMessageId = detail.currentNode
        } else if (definition.id === 'grokweb') {
          const detail = await grokControl(GrokProxyControlAction.GetConversation, {
            conversationId: original.conversationId,
          })
          if (
            !detail?.previousResponseID ||
            (context.nativeRef.head && detail.previousResponseID !== context.nativeRef.head)
          )
            throw new EngineError(
              'BINDING_CHANGED',
              'The native Grok conversation head changed or could not be verified.',
            )
          original.previousResponseID = detail.previousResponseID
        } else if (original.geminiWebServerTurnId) {
          const detail = await gemini.readConversation({
            conversationId: original.conversationId,
            limit: 1,
          })
          if (
            !detail.headCompleted ||
            detail.serverHead !== original.geminiWebServerTurnId ||
            (original.geminiWebResponseId && detail.responseId !== original.geminiWebResponseId)
          )
            throw new EngineError(
              'BINDING_CHANGED',
              'The native Gemini head changed. Read its current history before continuing.',
            )
        } else if (!original.geminiWebDocumentId || !original.geminiWebTabId)
          throw new EngineError(
            'CONTEXT_UNAVAILABLE',
            'The original live Gemini document is unavailable.',
          )
      },
      async generate(request, context) {
        const session = sessionFor(request, context)
        session.autoClean = false
        session.engineAccountSalt ||= globalThis.crypto.randomUUID()
        if (definition.id === 'chatgptweb') {
          const options = request.extensions?.chatgptweb || {}
          session.chatgptWebModelSlugOverride = request.modelId
          session.chatgptWebThinkingEffortOverride =
            request.parameters?.thinkingEffort ||
            (needsChatgptWebThinkingEffort(request.modelId)
              ? context.config.chatgptWebThinkingEffort || CHATGPT_WEB_DEFAULT_THINKING_EFFORT
              : null)
          session.chatgptWebProjectId = options.projectId || session.chatgptWebProjectId || null
          session.chatgptWebHistoryDisabledOverride =
            options.historyDisabled ?? session.chatgptWebHistoryDisabledOverride
          session.chatgptWebImagePointers = context.legacySession?.chatgptWebImagePointers || []
          if (request.input.attachments?.length)
            session.chatgptWebImagePointers = await context.callExtension(
              'chatgptweb.attachments.upload',
              { images: request.input.attachments, projectId: session.chatgptWebProjectId },
            )
        }
        let observation = Promise.resolve(),
          indexed = false
        const observe =
          definition.id === 'chatgptweb'
            ? (packet, latest) => {
                if (packet.session)
                  observation = observation
                    .then(() => saveChatgptWebSessionSnapshot(latest, { source: 'engine-runtime' }))
                    .catch(() => {})
                if (
                  latest.conversationId &&
                  isProviderAdmissionMessage(packet) &&
                  !indexed &&
                  session.chatgptWebHistoryDisabledOverride !== true &&
                  context.config.disableWebModeHistory !== true
                ) {
                  indexed = true
                  observation = observation
                    .then(async () => {
                      await upsertChatgptWebCreatedConversationIndexEntry(latest.conversationId)
                      await updateChatgptWebConversationTurnIndex({
                        conversationId: latest.conversationId,
                        messageId: context.runId,
                        status: 'running',
                      })
                    })
                    .catch(() => {})
                }
                if (indexed && packet.done && packet.outcome === 'completed')
                  observation = observation
                    .then(() =>
                      updateChatgptWebConversationTurnIndex({
                        conversationId: latest.conversationId,
                        messageId: context.runId,
                        status: 'completed',
                      }),
                    )
                    .catch(() => {})
              }
            : undefined
        const result = await runNativeProvider(
          providers[definition.id],
          definition,
          session,
          context,
          observe,
        )
        await observation
        return result
      },
      status(config) {
        const blocked = definition.id === 'geminiweb' && config.geminiWebReady !== true
        return Promise.resolve({
          state: blocked ? 'blocked' : 'unknown',
          reason: blocked ? 'page-check-required' : 'revalidate-before-write',
          checkedAt: null,
        })
      },
      async listModels(query, context) {
        if (definition.id === 'geminiweb')
          return catalog(
            context.config.geminiWebReady === true ? [GEMINI_WEB_MODEL] : [],
            'page-check',
            null,
          )
        if (definition.id === 'grokweb')
          return catalog(
            context.config.grokWebSignedIn === true
              ? context.config.grokWebAccountModels || []
              : [],
            'account-probe',
            null,
          )
        if (query.refresh === true) {
          const models = await (deps.chatgptModels || listChatgptWebModelsWithFallback)()
          if (models?.length)
            await (deps.setConfig || setUserConfig)({ chatgptWebAccountModels: models })
          return catalog(models, 'native-read', now())
        }
        return catalog(context.config.chatgptWebAccountModels || [], 'cached-account-catalog', null)
      },
      extensionOperations: {},
    }
    adapter.append = adapter.generate
    if (definition.id !== 'geminiweb')
      adapter.review = async (query) => {
        if (query.acknowledgeUnverified !== true)
          throw new EngineError(
            'INVALID_REQUEST',
            'Inspect the original website and explicitly acknowledge the uncertain outcome first.',
          )
        await adapter.listConversations({ offset: 0, limit: 1, forceRefresh: true })
        return {
          ok: true,
          outcome: 'unconfirmed',
          message: 'New work is allowed; the original outcome remains unconfirmed.',
        }
      }
    if (definition.id === 'chatgptweb') {
      adapter.readConversation = (query) => chatgptRead(query)
      adapter.listConversations = (query) =>
        (deps.chatgptList || listChatgptWebConversationsWithFallback)(query)
      adapter.recover = async (reference) => {
        const ids = reference.session
        const result = await (deps.chatgptRecover || recoverChatgptWebTurnStatus)({
          conversationId: ids.conversationId,
          messageId: ids.messageId,
        })
        return result?.status === 'completed' && result.text?.trim()
          ? {
              outcome: 'completed',
              finalOutput: {
                version: 1,
                format: /<div class="chatgptbox-genui/.test(result.text) ? 'safe-html' : 'markdown',
                content: result.text,
                metadata: {
                  conversationId: ids.conversationId,
                  messageId: ids.messageId,
                  thoughtDurationSec: result.thoughtDurationSec ?? null,
                  evidence: 'exact-turn-read',
                },
              },
            }
          : { outcome: 'unknown' }
      }
      adapter.extensionOperations = {
        'chatgptweb.conversation.delete': {
          effect: 'write',
          resourceKey: (query) => `conversation:chatgptweb:${query.conversationId}`,
          validate: (query) => {
            if (!query.conversationId)
              throw new EngineError('INVALID_REQUEST', 'conversationId is required.')
          },
          run: async (query) => {
            await deleteConversation(await getChatGptAccessToken(), query.conversationId)
            return { deleted: true }
          },
          verify: (value) => value.deleted === true,
          persistResult: (value) => value,
        },
        'chatgptweb.message.feedback': {
          effect: 'write',
          resourceKey: (query) =>
            `conversation:chatgptweb:${query.conversationId || query.conversation_id}`,
          run: async (query) => {
            await sendMessageFeedback(await getChatGptAccessToken(), query)
            return { submitted: true }
          },
          verify: (value) => value.submitted === true,
          persistResult: (value) => value,
        },
        'chatgptweb.projects.list': {
          effect: 'read',
          run: (query) => listChatgptWebProjectsViaProxy(query),
        },
        'chatgptweb.attachments.upload': {
          effect: 'write',
          parentOperations: [Op.Generate, Op.Append],
          resourceKey: () => 'resource:chatgptweb:upload',
          validate(query) {
            assertKnownFields(query, ['images', 'projectId'], 'image upload')
            if (!Array.isArray(query.images) || !query.images.length || query.images.length > 4)
              throw new EngineError(
                'INPUT_UNSUPPORTED',
                'Upload requires one to four prepared images.',
              )
          },
          run: (query) => (deps.uploadImages || uploadChatgptWebImagesViaProxy)(query),
          verify: (value, query) =>
            Array.isArray(value) &&
            value.length === query.images.length &&
            value.every((image) => !!validateChatgptImagePointer(image)),
          // Asset IDs and dimensions are control metadata, not image bytes or
          // signed credentials. They permit an acknowledged upload to be read
          // after restart instead of uploaded again when its reply was lost.
          persistResult: (value) =>
            value.map((image) => ({
              ...validateChatgptImagePointer(image),
              attachmentId: image.attachmentId,
            })),
        },
        'chatgptweb.history.sync': {
          effect: 'read',
          run: (query) => syncChatgptWebConversationCacheWithFallback(query),
        },
      }
    } else if (definition.id === 'grokweb') {
      adapter.readConversation = (query) =>
        grokControl(GrokProxyControlAction.GetConversation, query)
      adapter.listConversations = (query) =>
        grokControl(GrokProxyControlAction.ListConversations, query)
    } else {
      adapter.review = (query) => gemini.review(query)
      adapter.listConversations = (query) => gemini.listConversations(query)
      adapter.readConversation = (query) => gemini.readConversation(query)
      adapter.recover = (reference, context) => gemini.recover(reference, context)
    }
    return adapter
  })
}
