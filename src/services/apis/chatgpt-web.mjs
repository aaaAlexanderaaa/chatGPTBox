// Thin adapter layer: re-exports the chatgpt-web client for callers that use
// the `apis/` import path. The implementation lives in
// `services/clients/chatgpt-web/client.mjs`. See services/README.md for the
// apis/ vs clients/ convention.
export {
  sendMessageFeedback,
  setConversationProperty,
  deleteConversation,
  sendModerations,
  getModels,
  getRequirements,
  getArkoseToken,
  isNeedWebsocket,
  sendWebsocketConversation,
  stopWebsocketConversation,
  registerWebsocket,
  generateAnswersWithChatgptWebApi,
} from '../clients/chatgpt-web/client.mjs'
