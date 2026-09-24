/**
 * Runtime message contract for the chatGPTBox extension.
 *
 * Every `Browser.runtime` / `Browser.tabs` message exchanged between the
 * background service worker, content scripts, popup, options, IndependentPanel,
 * and ApiServer page is identified by its `message.type` string. Until this
 * module existed those strings were duplicated as bare literals at every
 * sender and receiver — the classic "add a type at the sender, forget the
 * receiver" trap, and on top of that two casing conventions were in use.
 *
 * This module is the single source of truth. Senders build messages with
 * `RuntimeMessage.<NAME>` and receivers match against the same constant, so a
 * typo or a missing receiver is caught by `tests/message-contract.test.mjs`.
 *
 * Conventions
 * -----------
 * - `message.type` values are UPPER_SNAKE_CASE (the convention already used by
 *   the background `onMessage` dispatcher). Older lowercase `message.type`
 *   literals have been migrated to these constants.
 * - The chatgpt-web *proxy control* flow is a two-layer dispatch: a message of
 *   type `CHATGPT_PROXY_CONTROL_REQUEST` carries an `action` payload in
 *   `data.action`. Those action values live in `ChatgptProxyControlAction`
 *   below — they are deliberately lowercase (an on-wire protocol value shared
 *   with the local API bridge and ApiServer page) and are NOT message types.
 *
 * Layering note
 * -------------
 * This module is dependency-free (pure data) so it can be imported from both
 * the background bundle and every UI bundle without pulling in services code.
 */

// ---------------------------------------------------------------------------
// message.type values (the `type` field on a runtime message)
// ---------------------------------------------------------------------------

export const RuntimeMessage = {
  // Conversation lifecycle (content-script <-> background <-> UI)
  CreateChat: 'CREATE_CHAT',
  CloseChats: 'CLOSE_CHATS',
  DeleteConversation: 'DELETE_CONVERSATION',
  Feedback: 'FEEDBACK',

  // Tab / window navigation
  NewUrl: 'NEW_URL',
  OpenUrl: 'OPEN_URL',
  OpenChatWindow: 'OPEN_CHAT_WINDOW',
  OpenApiServer: 'OPEN_API_SERVER',
  OpenSidePanel: 'OPEN_SIDE_PANEL',
  DshModuleDiagnose: 'DSH_MODULE_DIAGNOSE',
  DshModuleRespond: 'DSH_MODULE_RESPOND',
  ActivateUrl: 'ACTIVATE_URL',
  PinTab: 'PIN_TAB',

  // ChatGPT proxy tab registration & request relay (background -> content-script)
  SetChatgptTab: 'SET_CHATGPT_TAB',
  ChatgptProxyRequest: 'CHATGPT_PROXY_REQUEST',
  ChatgptProxyControlRequest: 'CHATGPT_PROXY_CONTROL_REQUEST',
  ChatgptWebPageIntegrity: 'CHATGPT_WEB_PAGE_INTEGRITY',

  // Grok proxy tab request relay (background -> content-script)
  GrokProxyRequest: 'GROK_PROXY_REQUEST',
  GrokProxyControlRequest: 'GROK_PROXY_CONTROL_REQUEST',

  // ChatGPT Web conversation cache APIs (UI -> background)
  ChatgptWebListConversations: 'CHATGPT_WEB_LIST_CONVERSATIONS',
  ChatgptWebGetConversation: 'CHATGPT_WEB_GET_CONVERSATION',
  ChatgptWebRefreshConversation: 'CHATGPT_WEB_REFRESH_CONVERSATION',
  ChatgptWebSendConversationMessage: 'CHATGPT_WEB_SEND_CONVERSATION_MESSAGE',
  ChatgptWebCreateConversation: 'CHATGPT_WEB_CREATE_CONVERSATION',
  ChatgptWebSyncConversations: 'CHATGPT_WEB_SYNC_CONVERSATIONS',
  ChatgptWebStopConversationSync: 'CHATGPT_WEB_STOP_CONVERSATION_SYNC',
  ChatgptWebUnlockConversationSync: 'CHATGPT_WEB_UNLOCK_CONVERSATION_SYNC',
  ChatgptWebHydrateConversations: 'CHATGPT_WEB_HYDRATE_CONVERSATIONS',
  ChatgptWebStopConversationHydrate: 'CHATGPT_WEB_STOP_CONVERSATION_HYDRATE',
  ChatgptWebRetryHydrateFailure: 'CHATGPT_WEB_RETRY_HYDRATE_FAILURE',
  ChatgptWebClearHydrateFailures: 'CHATGPT_WEB_CLEAR_HYDRATE_FAILURES',
  ChatgptWebResetHydrateCircuit: 'CHATGPT_WEB_RESET_HYDRATE_CIRCUIT',
  ChatgptWebReconcileHydrate: 'CHATGPT_WEB_RECONCILE_HYDRATE',
  ChatgptWebListModels: 'CHATGPT_WEB_LIST_MODELS',
  GrokWebListModels: 'GROK_WEB_LIST_MODELS',
  GrokWebListConversations: 'GROK_WEB_LIST_CONVERSATIONS',
  GrokWebGetConversation: 'GROK_WEB_GET_CONVERSATION',
  GrokWebRefreshConversation: 'GROK_WEB_REFRESH_CONVERSATION',
  GrokWebCreateConversation: 'GROK_WEB_CREATE_CONVERSATION',
  GrokWebSendConversationMessage: 'GROK_WEB_SEND_CONVERSATION_MESSAGE',

  // API bridge diagnose (ApiServer page -> background)
  ApiBridgeDiagnose: 'API_BRIDGE_DIAGNOSE',

  // Cross-context helpers
  ChangeLang: 'CHANGE_LANG',
  RefreshMenu: 'REFRESH_MENU',
  GetExtractedContent: 'GET_EXTRACTED_CONTENT',

  // Web-protocol fingerprint probe (settings Check now + tab collect)
  ProtocolProbeCollect: 'PROTOCOL_PROBE_COLLECT',
  ProtocolProbeRun: 'PROTOCOL_PROBE_RUN',
}

/**
 * All known `message.type` values. Derived from RuntimeMessage so adding a new
 * entry above is the only change needed — `tests/message-contract.test.mjs`
 * asserts this set covers every type literal used in the codebase.
 */
export const RUNTIME_MESSAGE_TYPES = Object.freeze(new Set(Object.values(RuntimeMessage)))

// ---------------------------------------------------------------------------
// chatgpt-web proxy control `action` values (data.action, NOT a message.type)
// ---------------------------------------------------------------------------

/**
 * Action values carried inside a `CHATGPT_PROXY_CONTROL_REQUEST` message's
 * `data.action` field. These are dispatched by the content script running on
 * chatgpt.com and are also referenced by the local API bridge retry policy
 * (`RETRYABLE_CONTROL_ACTIONS` in ApiServer). Kept lowercase as an on-wire
 * protocol value; do not change without coordinating with the ApiServer page.
 */
export const ChatgptProxyControlAction = {
  ListConversations: 'chatgpt_web_list_conversations',
  GetConversation: 'chatgpt_web_get_conversation',
  RefreshConversation: 'chatgpt_web_refresh_conversation',
  SyncConversations: 'chatgpt_web_sync_conversations',
  ListModels: 'chatgpt_web_list_models',
}

export const CHATGPT_PROXY_CONTROL_ACTIONS = Object.freeze(
  new Set(Object.values(ChatgptProxyControlAction)),
)

// ---------------------------------------------------------------------------
// grok-web proxy control `action` values (data.action, NOT a message.type)
// ---------------------------------------------------------------------------

/**
 * Action values carried inside a `GROK_PROXY_CONTROL_REQUEST` message's
 * `data.action` field. These are dispatched by the content script running on
 * grok.com. Kept lowercase as an on-wire protocol value.
 */
export const GrokProxyControlAction = {
  ListConversations: 'grok_web_list_conversations',
  GetConversation: 'grok_web_get_conversation',
  RefreshConversation: 'grok_web_refresh_conversation',
  CreateConversation: 'grok_web_create_conversation',
  SendConversationMessage: 'grok_web_send_conversation_message',
  ListModels: 'grok_web_list_models',
}

export const GROK_PROXY_CONTROL_ACTIONS = Object.freeze(
  new Set(Object.values(GrokProxyControlAction)),
)
