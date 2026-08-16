import { GrokProxyControlAction, RuntimeMessage } from '../protocol/messages.mjs'

export function isGrokProxyMessage(message) {
  return (
    message?.type === RuntimeMessage.GrokProxyRequest ||
    message?.type === RuntimeMessage.GrokProxyControlRequest
  )
}

export async function handleGrokProxyMessage() {
  return { handled: false, action: GrokProxyControlAction.ListConversations }
}
