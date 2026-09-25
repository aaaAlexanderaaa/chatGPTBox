export function buildChatgptWebUserMessage(question, messageId) {
  return {
    id: messageId,
    author: {
      role: 'user',
    },
    create_time: Date.now() / 1000,
    content: {
      content_type: 'text',
      parts: [question],
    },
    metadata: {
      developer_mode_connector_ids: [],
      selected_connector_ids: [],
      selected_sync_knowledge_store_ids: [],
      selected_sources: [],
      selected_github_repos: [],
      selected_all_github_repos: false,
      serialization_metadata: {
        custom_symbol_offsets: [],
      },
    },
  }
}

export function buildChatgptWebConversationRequestBody({
  question,
  messageId,
  parentMessageId,
  model,
  thinkingEffort = null,
  prepareState = 'none',
  conversationId = undefined,
  timezone = null,
  timezoneOffsetMin = new Date().getTimezoneOffset(),
  clientContextualInfo = null,
  historyAndTrainingDisabled = false,
  websocketRequestId = null,
  localFunctionNames = ['local.continue_in_work'],
  profile = 'legacy',
} = {}) {
  if (profile === 'codex-webview') {
    return {
      action: 'next',
      ...(conversationId && { conversation_id: conversationId }),
      ...(parentMessageId &&
        parentMessageId !== 'client-created-root' && { parent_message_id: parentMessageId }),
      is_do_not_remember: historyAndTrainingDisabled === true,
      model,
      ...(thinkingEffort && { thinking_effort: thinkingEffort }),
      ...(timezone && { timezone }),
      timezone_offset_min: timezoneOffsetMin,
      local_function_names: Array.isArray(localFunctionNames) ? localFunctionNames : [],
      client_contextual_info: {
        app_name: 'chatgpt.com',
        app_surface: 'codex_browser',
        has_web_push_capabilities: clientContextualInfo?.has_web_push_capabilities === true,
        web_push_notification_permission:
          clientContextualInfo?.web_push_notification_permission || 'default',
      },
      messages: [
        {
          author: { metadata: {}, name: null, role: 'user' },
          channel: null,
          content: { content_type: 'text', parts: [question] },
          create_time: Date.now() / 1000,
          end_turn: null,
          id: messageId,
          metadata: {},
          recipient: 'all',
          status: 'finished_successfully',
          update_time: null,
          weight: 1,
        },
      ],
      supported_encodings: ['v1'],
      client_prepare_state: prepareState,
    }
  }
  const requestBody = {
    action: 'next',
    conversation_id: conversationId || undefined,
    messages: [buildChatgptWebUserMessage(question, messageId)],
    client_prepare_state: prepareState,
    conversation_mode: {
      kind: 'primary_assistant',
    },
    enable_message_followups: true,
    system_hints: [],
    supports_buffering: true,
    supported_encodings: ['v1'],
    client_contextual_info: clientContextualInfo || {
      is_dark_mode: false,
      time_since_loaded: 0,
      page_height: 0,
      page_width: 0,
      pixel_ratio: 1,
      screen_height: 0,
      screen_width: 0,
      app_name: 'chatgpt.com',
      has_web_push_capabilities: false,
      web_push_notification_permission: 'default',
    },
    paragen_cot_summary_display_override: 'allow',
    force_parallel_switch: 'auto',
    model,
    parent_message_id: parentMessageId,
    timezone_offset_min: timezoneOffsetMin,
    local_function_names: Array.isArray(localFunctionNames) ? localFunctionNames : [],
  }

  if (timezone) requestBody.timezone = timezone
  if (historyAndTrainingDisabled === true) requestBody.history_and_training_disabled = true
  if (websocketRequestId) requestBody.websocket_request_id = websocketRequestId
  if (thinkingEffort) requestBody.thinking_effort = thinkingEffort
  return requestBody
}

export function buildChatgptWebConversationPrepareBody(requestBody, profile = 'legacy') {
  if (profile === 'codex-webview') {
    const body = { ...requestBody }
    const message = body.messages?.[0]
    delete body.messages
    delete body.client_contextual_info
    delete body.supported_encodings
    return {
      ...body,
      client_prepare_state: 'sent',
      ...(message && { partial_query: { author: { role: 'user' }, content: message.content } }),
    }
  }
  const body = { ...requestBody, client_prepare_state: 'none' }
  // The prepare call warms the route; it must not submit the user's message.
  delete body.messages
  delete body.websocket_request_id
  return body
}

export function buildChatgptWebConversationInitBody(requestBody) {
  return {
    conversation_id: requestBody.conversation_id || null,
    conversation_origin: null,
    gizmo_id: null,
    requested_default_model: requestBody.model,
    system_hints: null,
    timezone: requestBody.timezone,
    timezone_offset_min: requestBody.timezone_offset_min,
  }
}

export function buildChatgptWebConversationHeaders({
  accessToken,
  cookie = '',
  oaiDeviceId = '',
  language = 'en-US',
  accountId = '',
  conduitToken = '',
  turnTraceId = '',
  apiPath = '/backend-api/f/conversation',
  requirementsToken = '',
  proofToken = '',
  turnstileToken = '',
  arkoseToken = '',
  needArkoseToken = false,
  sessionId = '',
} = {}) {
  const headers = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Oai-Language': language || 'en-US',
    'X-Openai-Target-Path': apiPath,
    'X-Openai-Target-Route': apiPath,
  }

  if (cookie) headers.Cookie = cookie
  if (oaiDeviceId) headers['Oai-Device-Id'] = oaiDeviceId
  if (accountId) headers['Chatgpt-Account-Id'] = accountId
  if (conduitToken) headers['X-Conduit-Token'] = conduitToken
  if (turnTraceId) headers['X-Oai-Turn-Trace-Id'] = turnTraceId
  if (sessionId) headers['Oai-Session-Id'] = sessionId
  if (requirementsToken) {
    headers['Openai-Sentinel-Chat-Requirements-Token'] = requirementsToken
  }
  if (proofToken) headers['Openai-Sentinel-Proof-Token'] = proofToken
  if (turnstileToken) headers['Openai-Sentinel-Turnstile-Token'] = turnstileToken
  if (needArkoseToken && arkoseToken) {
    headers['Openai-Sentinel-Arkose-Token'] = arkoseToken
  }

  return headers
}

export function extractChatgptWebConduitTokenFromHeaders(headers) {
  if (!headers || typeof headers.get !== 'function') return ''
  const value = headers.get('x-conduit-token')
  return typeof value === 'string' ? value.trim() : ''
}

export function extractChatgptWebTurnstileToken(requirements) {
  if (!requirements || typeof requirements !== 'object') return ''
  const candidates = [
    requirements.turnstile?.token,
    requirements.turnstile_token,
    requirements.token_turnstile,
    requirements.dx?.token,
  ]
  const match = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())
  return typeof match === 'string' ? match.trim() : ''
}
