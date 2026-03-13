// web version

import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { isEmpty } from 'lodash-es'
import {
  CHATGPT_WEB_DEFAULT_MODEL_SLUG,
  CHATGPT_WEB_DEFAULT_THINKING_EFFORT,
  CHATGPT_WEB_DEBUG_LOG_KEY,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  getUserConfig,
} from '../../config/index.mjs'
import { pushRecord, setAbortController } from './shared.mjs'
import Browser from 'webextension-polyfill'
import { v4 as uuidv4 } from 'uuid'
import { t } from 'i18next'
import { sha3_512 } from 'js-sha3'
import randomInt from 'random-int'
import { getModelValue } from '../../utils/model-name-convert.mjs'
import {
  createChatgptWebWebsocketBodyParser,
  createChatgptWebWebsocketRequestController,
} from './chatgpt-web-websocket-state.mjs'
import {
  extractChatgptWebConversationResult,
  extractChatgptWebMessageText,
  isPendingChatgptWebMessageStatus,
} from './chatgpt-web-conversation-state.mjs'

async function request(token, method, path, data) {
  const apiUrl = (await getUserConfig()).customChatGptWebApiUrl
  const response = await fetch(`${apiUrl}/backend-api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  })
  const responseText = await response.text()
  console.debug(`request: ${path}`, responseText)
  return { response, responseText }
}

const TRUSTED_CHATGPT_DESTINATION_SUFFIXES = ['chatgpt.com', 'openai.com']
const LEGACY_CHATGPT_WEB_MODEL_SLUGS = new Set([
  'auto',
  'gpt-4',
  'gpt-4o',
  'gpt-4o-mini',
  'text-davinci-002-render-sha-mobile',
  'gpt-4-mobile',
])
const CHATGPT_WEB_DEBUG_LOG_LIMIT = 80
const CHATGPT_WEB_SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'openai-sentinel-arkose-token',
  'openai-sentinel-chat-requirements-token',
  'openai-sentinel-proof-token',
  'oai-device-id',
])
function createAbortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError()
}

function isThinkingModelSlug(model) {
  return typeof model === 'string' && model.trim().endsWith('-thinking')
}

function waitWithAbort(ms, signal) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(createAbortError())
    }

    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function truncateString(value, maxLength = 2000) {
  if (typeof value !== 'string') return value
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...[truncated:${value.length}]`
}

function safeRawJson(value, maxLength = 32000) {
  try {
    const json = JSON.stringify(value)
    return truncateString(json, maxLength)
  } catch (error) {
    return `[unserializable:${error?.message || String(error)}]`
  }
}

function sanitizeDebugHeaders(headers = {}) {
  const safeHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = String(key || '').toLowerCase()
    if (CHATGPT_WEB_SENSITIVE_HEADERS.has(lower)) {
      safeHeaders[key] = '[REDACTED]'
    } else {
      safeHeaders[key] = truncateString(String(value || ''), 200)
    }
  }
  return safeHeaders
}

function sanitizeDebugRequestBody(body) {
  if (!body || typeof body !== 'object') return body
  const safeBody = {
    ...body,
  }

  if (Array.isArray(safeBody.messages)) {
    safeBody.messages = safeBody.messages.map((message) => {
      if (!message || typeof message !== 'object') return message
      const safeMessage = { ...message }
      if (
        safeMessage.content &&
        typeof safeMessage.content === 'object' &&
        Array.isArray(safeMessage.content.parts)
      ) {
        safeMessage.content = {
          ...safeMessage.content,
          parts: safeMessage.content.parts.map((part) =>
            typeof part === 'string' ? truncateString(part, 400) : part,
          ),
        }
      }
      return safeMessage
    })
  }

  return safeBody
}

async function appendChatgptWebDebugLog(config, stage, payload = {}) {
  if (config?.debugChatgptWebRequests !== true) return
  const entry = {
    at: new Date().toISOString(),
    stage,
    payload,
  }
  console.debug('[chatgpt-web-debug]', entry)
  try {
    const data = await Browser.storage.local.get({ [CHATGPT_WEB_DEBUG_LOG_KEY]: [] })
    const current = Array.isArray(data[CHATGPT_WEB_DEBUG_LOG_KEY])
      ? data[CHATGPT_WEB_DEBUG_LOG_KEY]
      : []
    const next = [...current, entry].slice(-CHATGPT_WEB_DEBUG_LOG_LIMIT)
    await Browser.storage.local.set({ [CHATGPT_WEB_DEBUG_LOG_KEY]: next })
  } catch (error) {
    console.debug('Failed to persist chatgpt web debug log', error)
  }
}

function isTrustedChatgptDestination(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return TRUSTED_CHATGPT_DESTINATION_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  } catch {
    return false
  }
}

export async function sendMessageFeedback(token, data) {
  await request(token, 'POST', '/conversation/message_feedback', data)
}

export async function setConversationProperty(token, conversationId, propertyObject) {
  await request(token, 'PATCH', `/conversation/${conversationId}`, propertyObject)
}

export async function deleteConversation(token, conversationId) {
  if (conversationId) await setConversationProperty(token, conversationId, { is_visible: false })
}

export async function sendModerations(token, question, conversationId, messageId) {
  await request(token, 'POST', `/moderations`, {
    conversation_id: conversationId,
    input: question,
    message_id: messageId,
    model: 'text-moderation-playground',
  })
}

export async function getModels(token) {
  const response = JSON.parse((await request(token, 'GET', '/models')).responseText)
  const modelSlugs = new Set()

  if (Array.isArray(response?.models)) {
    response.models.forEach((model) => {
      if (model?.slug) modelSlugs.add(model.slug)
    })
  }

  if (Array.isArray(response?.categories)) {
    response.categories.forEach((category) => {
      if (category?.default_model) modelSlugs.add(category.default_model)
      if (Array.isArray(category?.supported_models)) {
        category.supported_models.forEach((slug) => {
          if (slug) modelSlugs.add(slug)
        })
      }
    })
  }

  if (Array.isArray(response?.versions)) {
    response.versions.forEach((version) => {
      if (Array.isArray(version?.slugs)) {
        version.slugs.forEach((slug) => {
          if (slug) modelSlugs.add(slug)
        })
      }
    })
  }

  if (typeof response?.default_model_slug === 'string' && response.default_model_slug.trim()) {
    modelSlugs.add(response.default_model_slug.trim())
  }

  return [...modelSlugs]
}

function resolveChatgptWebModel({
  selectedModel,
  availableModels,
  fallbackModel = CHATGPT_WEB_DEFAULT_MODEL_SLUG,
}) {
  const normalizedSelectedModel =
    typeof selectedModel === 'string' ? selectedModel.trim() : selectedModel
  const hasExplicitSelection =
    typeof normalizedSelectedModel === 'string' && normalizedSelectedModel.length > 0
  const selectedIsLegacy = LEGACY_CHATGPT_WEB_MODEL_SLUGS.has(normalizedSelectedModel)

  if (hasExplicitSelection && !selectedIsLegacy) {
    if (Array.isArray(availableModels) && availableModels.length > 0) {
      if (availableModels.includes(normalizedSelectedModel)) {
        return {
          model: normalizedSelectedModel,
          selectionReason: 'selected_in_catalog',
          catalogHit: true,
        }
      }
      // Keep explicit user choice even if /models does not currently include it.
      return {
        model: normalizedSelectedModel,
        selectionReason: 'selected_forced_not_in_catalog',
        catalogHit: false,
      }
    }
    return {
      model: normalizedSelectedModel,
      selectionReason: 'selected_without_catalog',
      catalogHit: null,
    }
  }

  if (Array.isArray(availableModels) && availableModels.length > 0) {
    if (availableModels.includes(fallbackModel)) {
      return {
        model: fallbackModel,
        selectionReason: hasExplicitSelection
          ? 'legacy_selected_fallback_default'
          : 'default_fallback',
        catalogHit: true,
      }
    }
    const modernCandidate = availableModels.find(
      (slug) => !LEGACY_CHATGPT_WEB_MODEL_SLUGS.has(slug),
    )
    if (modernCandidate) {
      return {
        model: modernCandidate,
        selectionReason: hasExplicitSelection
          ? 'legacy_selected_fallback_modern'
          : 'fallback_modern_candidate',
        catalogHit: true,
      }
    }
    return {
      model: availableModels[0],
      selectionReason: hasExplicitSelection
        ? 'legacy_selected_fallback_first'
        : 'fallback_first_catalog',
      catalogHit: true,
    }
  }

  if (hasExplicitSelection && selectedIsLegacy) {
    return {
      model: fallbackModel,
      selectionReason: 'legacy_selected_without_catalog',
      catalogHit: null,
    }
  }
  return {
    model: fallbackModel,
    selectionReason: 'default_without_catalog',
    catalogHit: null,
  }
}

function resolveThinkingEffortForModel(modelSlug, config) {
  const normalized = typeof modelSlug === 'string' ? modelSlug.trim() : ''
  if (!normalized.endsWith('-thinking')) return null
  if (config?.chatgptWebThinkingEffort === 'standard') return 'standard'
  return CHATGPT_WEB_DEFAULT_THINKING_EFFORT
}

export async function getRequirements(accessToken) {
  const response = JSON.parse(
    (await request(accessToken, 'POST', '/sentinel/chat-requirements')).responseText,
  )
  if (response) {
    return response
  }
}

export async function getArkoseToken(config) {
  if (!config.chatgptArkoseReqUrl)
    throw new Error(
      t('Please login at https://chatgpt.com first') +
        '\n\n' +
        t(
          "Please keep https://chatgpt.com open and try again. If it still doesn't work, type some characters in the input box of chatgpt web page and try again.",
        ),
    )
  const arkoseToken = await fetch(
    config.chatgptArkoseReqUrl + '?' + config.chatgptArkoseReqParams,
    {
      method: 'POST',
      body: config.chatgptArkoseReqForm,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
    },
  )
    .then((resp) => resp.json())
    .then((resp) => resp.token)
    .catch(() => null)
  if (!arkoseToken)
    throw new Error(
      t('Failed to get arkose token.') +
        '\n\n' +
        t(
          "Please keep https://chatgpt.com open and try again. If it still doesn't work, type some characters in the input box of chatgpt web page and try again.",
        ),
    )
  return arkoseToken
}

// https://github.com/tctien342/chatgpt-proxy/blob/9147a4345b34eece20681f257fd475a8a2c81171/src/openai.ts#L103
// https://github.com/zatxm/aiproxy
function generateProofToken(seed, diff, userAgent) {
  const cores = [1, 2, 4]
  const screens = [3008, 4010, 6000]
  const reacts = [
    '_reactListeningcfilawjnerp',
    '_reactListening9ne2dfo1i47',
    '_reactListening410nzwhan2a',
  ]
  const acts = ['alert', 'ontransitionend', 'onprogress']

  const core = cores[randomInt(0, cores.length)]
  const screen = screens[randomInt(0, screens.length)] + core
  const react = reacts[randomInt(0, reacts.length)]
  const act = acts[randomInt(0, acts.length)]

  const parseTime = new Date().toString()

  const config = [
    screen,
    parseTime,
    4294705152,
    0,
    userAgent,
    'https://tcr9i.chat.openai.com/v2/35536E1E-65B4-4D96-9D97-6ADB7EFF8147/api.js',
    'dpl=1440a687921de39ff5ee56b92807faaadce73f13',
    'en',
    'en-US',
    4294705152,
    'plugins−[object PluginArray]',
    react,
    act,
  ]

  const diffLen = diff.length

  for (let i = 0; i < 200000; i++) {
    config[3] = i
    const jsonData = JSON.stringify(config)
    // eslint-disable-next-line no-undef
    const base = Buffer.from(jsonData).toString('base64')
    const hashValue = sha3_512.create().update(seed + base)

    if (hashValue.hex().substring(0, diffLen) <= diff) {
      const result = 'gAAAAAB' + base
      return result
    }
  }

  // eslint-disable-next-line no-undef
  const fallbackBase = Buffer.from(`"${seed}"`).toString('base64')
  return 'gAAAAABwQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D' + fallbackBase
}

export async function isNeedWebsocket(accessToken) {
  return (await request(accessToken, 'GET', '/accounts/check/v4-2023-04-27')).responseText.includes(
    'shared_websocket',
  )
}

export async function sendWebsocketConversation(accessToken, options) {
  const apiUrl = (await getUserConfig()).customChatGptWebApiUrl
  const response = await fetch(`${apiUrl}/backend-api/conversation`, options).then((r) => r.json())
  console.debug(`request: ws /conversation`, response)
  return { conversationId: response.conversation_id, wsRequestId: response.websocket_request_id }
}

export async function stopWebsocketConversation(accessToken, conversationId, wsRequestId) {
  await request(accessToken, 'POST', '/stop_conversation', {
    conversation_id: conversationId,
    websocket_request_id: wsRequestId,
  })
}

/**
 * @type {WebSocket}
 */
let websocket
/**
 * @type {Date}
 */
let expires_at
let wsCallbacks = []

function removeWsCallback(callback) {
  wsCallbacks = wsCallbacks.filter((entry) => entry !== callback)
}

function notifyPendingWsCallbacks(error) {
  const callbacks = wsCallbacks.slice()
  wsCallbacks = []
  callbacks.forEach((entry) => {
    try {
      entry.onClose?.(error)
    } catch (callbackError) {
      console.debug('websocket close callback failed', callbackError)
    }
  })
}

export async function registerWebsocket(accessToken) {
  if (websocket && new Date() < expires_at - 300000) return true

  const response = JSON.parse(
    (await request(accessToken, 'POST', '/register-websocket')).responseText,
  )
  if (!response.wss_url) {
    throw new Error('Websocket unavailable')
  }
  return new Promise((resolve, reject) => {
    websocket = new WebSocket(response.wss_url)
    websocket.onopen = () => {
      console.debug('global websocket opened')
      resolve(true)
    }
    websocket.onerror = (err) => {
      websocket = null
      expires_at = null
      reject(err)
    }
    websocket.onclose = () => {
      websocket = null
      expires_at = null
      console.debug('global websocket closed')
      notifyPendingWsCallbacks(new Error('ChatGPT websocket closed before response completed'))
    }
    websocket.onmessage = (event) => {
      wsCallbacks.forEach((entry) => entry.onMessage?.(event))
    }
    expires_at = new Date(response.expires_at)
  })
}

/**
 * @param {Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 * @param {string} accessToken
 */
export async function generateAnswersWithChatgptWebApi(port, question, session, accessToken) {
  const { controller, cleanController } = setAbortController(
    port,
    () => {
      if (session.wsRequestId)
        stopWebsocketConversation(accessToken, session.conversationId, session.wsRequestId)
    },
    () => {
      if (session.autoClean) deleteConversation(accessToken, session.conversationId)
    },
  )
  let promptDispatchCommitted = false
  let lastEmittedSessionSignature = ''

  function markReplayUnsafe(error) {
    if (
      (promptDispatchCommitted || session.conversationId || lastAssistantMessageId) &&
      error &&
      typeof error === 'object'
    ) {
      error.chatgptWebRequestReplayUnsafe = true
    }
    return error
  }

  const config = await getUserConfig()
  let arkoseError
  const [models, requirements, arkoseToken, websocketFlag] = await Promise.all([
    getModels(accessToken).catch(() => undefined),
    getRequirements(accessToken).catch(() => undefined),
    getArkoseToken(config).catch((e) => {
      arkoseError = e
    }),
    isNeedWebsocket(accessToken).catch(() => undefined),
  ])
  let useWebsocket = Boolean(websocketFlag)
  console.debug('models', models)
  let usedModel
  let modelDecision
  let selectedModel
  if (session.chatgptWebModelSlugOverride) {
    usedModel = session.chatgptWebModelSlugOverride
    selectedModel = usedModel
    modelDecision = { model: usedModel, selectionReason: 'api_server_override', catalogHit: null }
  } else {
    selectedModel = getModelValue(session)
    modelDecision = resolveChatgptWebModel({
      selectedModel,
      availableModels: models,
    })
    usedModel = modelDecision.model
  }
  const thinkingEffort = resolveThinkingEffortForModel(usedModel, config)
  const isExtendedThinkingRequest =
    isThinkingModelSlug(usedModel) || thinkingEffort === CHATGPT_WEB_DEFAULT_THINKING_EFFORT
  const useDispatchOnlyConversationObserver = Boolean(useWebsocket && isExtendedThinkingRequest)
  if (!useDispatchOnlyConversationObserver) {
    useWebsocket = false
  }
  void appendChatgptWebDebugLog(config, 'model-resolution', {
    selectedModel,
    usedModel,
    selectionReason: modelDecision.selectionReason,
    catalogHit: modelDecision.catalogHit,
    thinkingEffort: thinkingEffort || null,
    useDispatchOnlyConversationObserver,
    availableModelCount: Array.isArray(models) ? models.length : 0,
    availableModels: Array.isArray(models) ? models : [],
  })
  console.debug('usedModel', usedModel)
  const needArkoseToken = requirements && requirements.arkose?.required
  if (arkoseError && needArkoseToken) throw arkoseError

  let proofToken
  if (requirements?.proofofwork?.required) {
    proofToken = generateProofToken(
      requirements.proofofwork.seed,
      requirements.proofofwork.difficulty,
      navigator.userAgent,
    )
  }

  const url = `${config.customChatGptWebApiUrl}${config.customChatGptWebApiPath}`
  const shouldAttachChatgptCookies = isTrustedChatgptDestination(url)
  let cookie
  let oaiDeviceId
  if (shouldAttachChatgptCookies && Browser.cookies && Browser.cookies.getAll) {
    cookie = (await Browser.cookies.getAll({ url: 'https://chatgpt.com/' }))
      .map((cookie) => {
        return `${cookie.name}=${cookie.value}`
      })
      .join('; ')
    const oaiCookie = await Browser.cookies.get({
      url: 'https://chatgpt.com/',
      name: 'oai-did',
    })
    oaiDeviceId = oaiCookie?.value
  }

  session.messageId = uuidv4()
  session.wsRequestId = uuidv4()
  if (session.parentMessageId == null) {
    session.parentMessageId = uuidv4()
  }
  const requestBody = {
    action: 'next',
    conversation_id: session.conversationId || undefined,
    messages: [
      {
        id: session.messageId,
        author: {
          role: 'user',
        },
        content: {
          content_type: 'text',
          parts: [question],
        },
      },
    ],
    conversation_mode: {
      kind: 'primary_assistant',
    },
    force_paragen: false,
    force_rate_limit: false,
    suggestions: [],
    model: usedModel,
    parent_message_id: session.parentMessageId,
    timezone_offset_min: new Date().getTimezoneOffset(),
    history_and_training_disabled:
      typeof session.chatgptWebHistoryDisabledOverride === 'boolean'
        ? session.chatgptWebHistoryDisabledOverride
        : config.disableWebModeHistory,
    websocket_request_id: session.wsRequestId,
  }
  if (thinkingEffort) {
    requestBody.thinking_effort = thinkingEffort
  }
  void appendChatgptWebDebugLog(config, 'thinking-effort', {
    model: usedModel,
    selectedModel,
    configuredThinkingEffort: config?.chatgptWebThinkingEffort || null,
    appliedThinkingEffort: thinkingEffort || null,
    includedInRequestBody: Object.prototype.hasOwnProperty.call(requestBody, 'thinking_effort'),
  })

  const options = {
    method: 'POST',
    signal: controller.signal,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(cookie && { Cookie: cookie }),
      ...(needArkoseToken && { 'Openai-Sentinel-Arkose-Token': arkoseToken }),
      ...(requirements && { 'Openai-Sentinel-Chat-Requirements-Token': requirements.token }),
      ...(proofToken && { 'Openai-Sentinel-Proof-Token': proofToken }),
      ...(oaiDeviceId && { 'Oai-Device-Id': oaiDeviceId }),
      'Oai-Language': 'en-US',
    },
    body: JSON.stringify(requestBody),
  }
  void appendChatgptWebDebugLog(config, 'wire-request', {
    endpointUrl: url,
    method: options.method,
    headers: sanitizeDebugHeaders(options.headers),
    requestBodyRawJson: safeRawJson(requestBody),
  })
  void appendChatgptWebDebugLog(config, 'request-prepared', {
    requestUrl: url,
    method: options.method,
    model: usedModel,
    selectedModel,
    appliedThinkingEffort: thinkingEffort || null,
    includedThinkingEffort: Object.prototype.hasOwnProperty.call(requestBody, 'thinking_effort'),
    useWebsocket,
    needArkoseToken: Boolean(needArkoseToken),
    headers: sanitizeDebugHeaders(options.headers),
    body: sanitizeDebugRequestBody(requestBody),
  })

  let answer = ''
  let generationPrefixAnswer = ''
  let generatedImageUrl = ''
  let responseMetaLogged = false
  let lastAssistantStatus = ''
  let lastAssistantMessageId = null
  let lastIncrementalAnswer = ''
  let lastIncrementalSkipSignature = ''
  let finalizationPromise = null
  const conversationPollTimeoutMs =
    Math.max(
      1,
      Number(config.chatgptWebConversationPollTimeoutSeconds) ||
        DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
    ) * 1000
  const conversationPollIntervalMs =
    Math.max(
      1,
      Number(config.chatgptWebConversationPollIntervalSeconds) ||
        DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
    ) * 1000
  const conversationNotFoundGraceMs = Math.min(60000, conversationPollTimeoutMs)
  const shouldEmitIncrementalAnswer =
    typeof session.chatgptWebIncrementalOutput === 'boolean'
      ? session.chatgptWebIncrementalOutput
      : !isExtendedThinkingRequest

  function emitSessionUpdate(force = false) {
    const signature = [
      session.conversationId || '',
      session.parentMessageId || '',
      session.messageId || '',
      session.wsRequestId || '',
    ].join(':')

    if (!force && signature === lastEmittedSessionSignature) return
    lastEmittedSessionSignature = signature
    port.postMessage({ session: { ...session } })
  }

  function withRichContent(text) {
    return (
      generationPrefixAnswer + (generatedImageUrl && `\n\n![](${generatedImageUrl})\n\n`) + text
    )
  }

  function emitIntermediateAnswerSnapshot({
    channel = null,
    pending = false,
    source = 'unknown',
  } = {}) {
    if (!answer || !shouldEmitIncrementalAnswer) return

    const normalizedChannel =
      typeof channel === 'string' ? channel.trim().toLowerCase() : ''

    if (isExtendedThinkingRequest && normalizedChannel === 'commentary') {
      logSkippedIncrementalAnswer({
        source,
        reason: 'commentary_channel',
        channel: normalizedChannel,
        pending,
        answerLength: answer.length,
      })
      return
    }

    if (lastIncrementalAnswer && !answer.startsWith(lastIncrementalAnswer)) {
      logSkippedIncrementalAnswer({
        source,
        reason: 'non_monotonic_snapshot',
        channel: normalizedChannel || null,
        pending,
        answerLength: answer.length,
        previousAnswerLength: lastIncrementalAnswer.length,
      })
      return
    }

    if (answer === lastIncrementalAnswer) return

    lastIncrementalAnswer = answer
    port.postMessage({ answer: answer, done: false, session: null })
  }

  function logSkippedIncrementalAnswer(payload = {}) {
    const signature = JSON.stringify(payload)
    if (signature === lastIncrementalSkipSignature) return
    lastIncrementalSkipSignature = signature
    void appendChatgptWebDebugLog(config, 'incremental-answer-skipped', {
      model: usedModel,
      ...payload,
    })
  }

  function shouldPollConversationResult(terminalError) {
    if (!session.conversationId) return false
    if (!isThinkingModelSlug(usedModel) && thinkingEffort !== 'extended') return false
    if (terminalError instanceof Error) return true
    return true
  }

  async function fetchConversationResultSnapshot() {
    throwIfAborted(controller.signal)

    const response = await fetch(
      `${config.customChatGptWebApiUrl}/backend-api/conversation/${session.conversationId}`,
      {
        method: 'GET',
        signal: controller.signal,
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(cookie && { Cookie: cookie }),
          ...(oaiDeviceId && { 'Oai-Device-Id': oaiDeviceId }),
          'Oai-Language': 'en-US',
        },
      },
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      let errorPayload = null
      try {
        errorPayload = errorText ? JSON.parse(errorText) : null
      } catch {
        errorPayload = null
      }

      const errorMessage =
        errorPayload?.detail?.message ||
        errorPayload?.message ||
        errorText ||
        `Failed to fetch ChatGPT conversation ${response.status} ${response.statusText}`

      const error = new Error(errorMessage)
      error.chatgptWebConversationFetchStatus = response.status
      error.chatgptWebConversationFetchCode =
        errorPayload?.detail?.code || errorPayload?.code || null
      error.chatgptWebConversationFetchRaw = errorText || null
      throw error
    }

    return response.json()
  }

  async function pollConversationResult(reason) {
    const startedAt = Date.now()
    let attempts = 0
    let lastObservedSignature = ''
    let consecutiveFinalPolls = 0
    const requiredConsecutiveFinal = isExtendedThinkingRequest ? 2 : 1

    while (Date.now() - startedAt < conversationPollTimeoutMs) {
      attempts += 1
      let snapshot
      try {
        snapshot = await fetchConversationResultSnapshot()
      } catch (error) {
        const isConversationNotFound =
          error?.chatgptWebConversationFetchStatus === 404 &&
          error?.chatgptWebConversationFetchCode === 'conversation_not_found'

        if (isConversationNotFound && Date.now() - startedAt < conversationNotFoundGraceMs) {
          void appendChatgptWebDebugLog(config, 'conversation-poll-not-found', {
            reason,
            attempts,
            conversationId: session.conversationId || null,
            retrying: true,
            graceSeconds: Math.round(conversationNotFoundGraceMs / 1000),
            intervalSeconds: Math.round(conversationPollIntervalMs / 1000),
            error: error?.message || String(error),
          })
          await waitWithAbort(conversationPollIntervalMs, controller.signal)
          continue
        }
        throw error
      }
      const result = extractChatgptWebConversationResult(snapshot, {
        userMessageId: session.messageId,
        assistantMessageId: lastAssistantMessageId,
      })

      if (result?.messageId) {
        lastAssistantMessageId = result.messageId
        session.parentMessageId = result.messageId
        emitSessionUpdate()
      }
      if (result?.status) {
        lastAssistantStatus = result.status
      }
      if (typeof result?.text === 'string' && result.text) {
        const nextAnswer = withRichContent(result.text)
        if (nextAnswer !== answer) {
          answer = nextAnswer
          emitIntermediateAnswerSnapshot({
            source: 'conversation_poll',
            channel: result.channel,
            pending: result.pending === true,
          })
        }
      }

      const signature = `${result?.messageId || ''}:${result?.status || ''}:${
        result?.text?.length || 0
      }`
      if (signature !== lastObservedSignature) {
        lastObservedSignature = signature
        void appendChatgptWebDebugLog(config, 'conversation-poll-progress', {
          reason,
          attempts,
          conversationId: session.conversationId || null,
          messageId: result?.messageId || null,
          status: result?.status || null,
          answerLength: result?.text?.length || 0,
        })
      }

      if (result?.isFinal && !result.pending && result.text) {
        consecutiveFinalPolls += 1
        if (consecutiveFinalPolls >= requiredConsecutiveFinal) {
          void appendChatgptWebDebugLog(config, 'conversation-poll-complete', {
            reason,
            attempts,
            conversationId: session.conversationId || null,
            messageId: result.messageId || null,
            status: result.status || null,
            pending: result.pending === true,
            asyncStatus: result.asyncStatus ?? null,
            answerLength: result.text.length,
            consecutiveFinalPolls,
          })
          return
        }
      } else {
        consecutiveFinalPolls = 0
      }

      await waitWithAbort(conversationPollIntervalMs, controller.signal)
    }

    throw new Error(
      `Timed out after ${Math.round(
        conversationPollTimeoutMs / 1000,
      )} seconds waiting for ChatGPT conversation result`,
    )
  }

  async function finalizeMessage(reason, terminalError = null) {
    if (finalizationPromise) return finalizationPromise

    finalizationPromise = (async () => {
      try {
        if (shouldPollConversationResult(terminalError)) {
          void appendChatgptWebDebugLog(config, 'conversation-poll-start', {
            reason,
            conversationId: session.conversationId || null,
            messageId: session.messageId || null,
            lastAssistantMessageId,
            lastAssistantStatus: lastAssistantStatus || null,
            intervalSeconds: Math.round(conversationPollIntervalMs / 1000),
            timeoutSeconds: Math.round(conversationPollTimeoutMs / 1000),
            currentAnswerLength: answer.length,
            hadTerminalError: terminalError instanceof Error,
            terminalError: terminalError?.message || null,
          })
          await pollConversationResult(reason)
        } else if (terminalError) {
          throw terminalError
        }

        finishMessage()
      } finally {
        cleanController()
      }
    })()

    return finalizationPromise
  }

  if (useDispatchOnlyConversationObserver) {
    try {
      const { conversationId, wsRequestId } = await sendWebsocketConversation(accessToken, options)
      promptDispatchCommitted = true
      session.conversationId = conversationId || session.conversationId
      session.wsRequestId = wsRequestId || session.wsRequestId
      void appendChatgptWebDebugLog(config, 'conversation-dispatch-ack', {
        transport: 'dispatch_only_websocket_ack',
        conversationId: session.conversationId || null,
        wsRequestId: session.wsRequestId || null,
        model: usedModel,
      })
      emitSessionUpdate(true)
      await pollConversationResult('dispatch_only_ack')
      finishMessage()
      cleanController()
      return
    } catch (error) {
      cleanController()
      throw markReplayUnsafe(error)
    }
  }

  if (useWebsocket) {
    try {
      await registerWebsocket(accessToken)
    } catch (error) {
      console.debug('websocket registration failed, falling back to SSE', error)
      void appendChatgptWebDebugLog(config, 'websocket-register-failed', {
        error: error?.message || String(error),
      })
      useWebsocket = false
    }
    await new Promise((resolve, reject) => {
      let wsCallback
      const requestController = createChatgptWebWebsocketRequestController({
        session,
        handleMessage,
        finishMessage: () => {
          void finalizeMessage('websocket_done').then(resolve, reject)
        },
        failMessage: (error) => {
          void finalizeMessage('websocket_closed', error).then(resolve, reject)
        },
        cleanup: () => {
          if (wsCallback) removeWsCallback(wsCallback)
        },
      })
      const bodyParsers = new Map()

      const getBodyParser = (conversationId) => {
        if (!bodyParsers.has(conversationId)) {
          bodyParsers.set(
            conversationId,
            createChatgptWebWebsocketBodyParser({
              handleMessage(data) {
                console.debug('ws message', data)
                requestController.handleSocketEvent({
                  type: 'message',
                  conversationId,
                  data,
                })
              },
              handleDone() {
                console.debug('ws message', '[DONE]')
                bodyParsers.delete(conversationId)
                requestController.handleSocketEvent({
                  type: 'done',
                  conversationId,
                  data: null,
                })
              },
              handleParseError(error) {
                console.debug('json error', error)
              },
            }),
          )
        }
        return bodyParsers.get(conversationId)
      }

      wsCallback = {
        onMessage(event) {
          let wsData
          try {
            wsData = JSON.parse(event.data)
          } catch (error) {
            console.debug('json error', error)
            return
          }
          if (wsData.type !== 'http.response.body') return
          let body
          try {
            body = atob(wsData.body)
            const trimmedBody = body.trim()
            if (
              !responseMetaLogged &&
              trimmedBody &&
              trimmedBody !== '[DONE]' &&
              trimmedBody !== 'data: [DONE]'
            ) {
              responseMetaLogged = true
              void appendChatgptWebDebugLog(config, 'wire-response-meta', {
                transport: 'websocket',
                responseChunkRawJson: truncateString(body, 16000),
              })
            }
            getBodyParser(wsData.conversation_id).feed(body)
          } catch (error) {
            console.debug('json error', error)
            requestController.handleSocketClose(error)
          }
        },
        onClose(error) {
          requestController.handleSocketClose(error)
        },
      }
      wsCallbacks.push(wsCallback)
      ;(async () => {
        try {
          const { conversationId, wsRequestId } = await sendWebsocketConversation(
            accessToken,
            options,
          )
          promptDispatchCommitted = true
          const dispatchResult = requestController.confirmDispatch({
            conversationId,
            wsRequestId,
          })
          if (!dispatchResult.accepted || dispatchResult.settled) return

          void appendChatgptWebDebugLog(config, 'websocket-dispatch', {
            conversationId,
            wsRequestId,
            model: usedModel,
          })
          emitSessionUpdate(true)

          if (dispatchResult.bufferedCount > 0) {
            void appendChatgptWebDebugLog(config, 'websocket-buffer-flush', {
              bufferedCount: dispatchResult.bufferedCount,
              conversationId,
              model: usedModel,
            })
          }
        } catch (error) {
          requestController.handleSocketClose(markReplayUnsafe(error))
        }
      })()
    })
  } else {
    await fetchSSE(url, {
      ...options,
      async onResponse() {
        promptDispatchCommitted = true
      },
      onMessage(message) {
        console.debug('sse message', message)
        if (message.trim() === '[DONE]') {
          return
        }
        if (!responseMetaLogged) {
          responseMetaLogged = true
          void appendChatgptWebDebugLog(config, 'wire-response-meta', {
            transport: 'sse',
            responseChunkRawJson: truncateString(message, 16000),
          })
        }
        let data
        try {
          data = JSON.parse(message)
        } catch (error) {
          console.debug('json error', error)
          return
        }
        try {
          handleMessage(data)
        } catch (error) {
          void finalizeMessage('sse_message_error', markReplayUnsafe(error))
        }
      },
      async onStart() {
        promptDispatchCommitted = true
        // sendModerations(accessToken, question, session.conversationId, session.messageId)
      },
      async onEnd() {
        await finalizeMessage('sse_end')
      },
      async onError(resp) {
        if (resp instanceof Error) {
          await finalizeMessage('sse_error', markReplayUnsafe(resp))
          return
        }
        const debugErrorText = await resp
          .clone()
          .text()
          .catch(() => '')
        void appendChatgptWebDebugLog(config, 'sse-error', {
          status: resp.status,
          statusText: resp.statusText,
          body: truncateString(debugErrorText, 4000),
        })
        if (resp.status === 403) {
          await finalizeMessage('sse_error', markReplayUnsafe(new Error('CLOUDFLARE')))
          return
        }
        const error = await resp.json().catch(() => ({}))
        await finalizeMessage(
          'sse_error',
          markReplayUnsafe(
            new Error(
              !isEmpty(error) ? JSON.stringify(error) : `${resp.status} ${resp.statusText}`,
            ),
          ),
        )
      },
    })
  }

  function handleMessage(data) {
    if (data.error) {
      void appendChatgptWebDebugLog(config, 'message-error', {
        model: usedModel,
        error: data.error,
      })
      throw new Error(JSON.stringify(data.error))
    }

    if (data.conversation_id) {
      session.conversationId = data.conversation_id
      promptDispatchCommitted = true
    }
    if (data.message?.author?.role === 'assistant') {
      lastAssistantMessageId = data.message.id || lastAssistantMessageId
      if (data.message?.id) {
        session.parentMessageId = data.message.id
        promptDispatchCommitted = true
      }
      lastAssistantStatus =
        typeof data.message?.status === 'string' ? data.message.status : lastAssistantStatus
    }
    if (session.conversationId || session.parentMessageId) {
      emitSessionUpdate()
    }

    const respAns = extractChatgptWebMessageText(data.message)
    const respPart = data.message?.content?.parts?.[0]
    const contentType = data.message?.content?.content_type
    const messageChannel =
      typeof data.message?.channel === 'string' ? data.message.channel : null
    if (contentType === 'text' && respAns) {
      answer = withRichContent(respAns)
    } else if (contentType === 'code' && data.message?.status === 'in_progress') {
      const generationText = '\n\n' + t('Generating...')
      if (answer && !answer.endsWith(generationText)) generationPrefixAnswer = answer
      answer = generationPrefixAnswer + generationText
    } else if (
      contentType === 'multimodal_text' &&
      respPart?.content_type === 'image_asset_pointer'
    ) {
      const imageAsset = respPart?.asset_pointer || ''
      if (imageAsset) {
        fetch(
          `${config.customChatGptWebApiUrl}/backend-api/files/${imageAsset.replace(
            'file-service://',
            '',
          )}/download`,
          {
            credentials: 'include',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(cookie && { Cookie: cookie }),
            },
          },
        ).then((r) => r.json().then((json) => (generatedImageUrl = json?.download_url)))
      }
    }

    emitIntermediateAnswerSnapshot({
      source: 'transport',
      channel: messageChannel,
      pending: isPendingChatgptWebMessageStatus(data.message?.status),
    })
  }

  function finishMessage() {
    void appendChatgptWebDebugLog(config, 'completed', {
      selectedModel,
      model: usedModel,
      selectionReason: modelDecision.selectionReason,
      catalogHit: modelDecision.catalogHit,
      appliedThinkingEffort: thinkingEffort || null,
      conversationId: session.conversationId || null,
      parentMessageId: session.parentMessageId || null,
      answerLength: answer.length,
    })
    pushRecord(session, question, answer)
    console.debug('conversation history', { content: session.conversationRecords })
    port.postMessage({ answer: answer, done: true, session: session })
  }
}
