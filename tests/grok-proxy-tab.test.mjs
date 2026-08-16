import { describe, expect, it } from 'vitest'
import { isDedicatedGrokProxyTabUrl, isLikelyGrokTabUrl } from '../src/utils/grok-proxy-tab.mjs'
import { GrokProxyControlAction, RuntimeMessage } from '../src/protocol/messages.mjs'

describe('grok proxy tab url', () => {
  it('accepts grok.com', () => {
    expect(isLikelyGrokTabUrl('https://grok.com/')).toBe(true)
    expect(isLikelyGrokTabUrl('https://chatgpt.com/')).toBe(false)
  })

  it('requires the proxy query and rejects login', () => {
    expect(isDedicatedGrokProxyTabUrl('https://grok.com/?chatgptbox_proxy=1')).toBe(true)
    expect(isDedicatedGrokProxyTabUrl('https://grok.com/')).toBe(false)
    expect(isDedicatedGrokProxyTabUrl('https://grok.com/login?chatgptbox_proxy=1')).toBe(false)
  })
})

describe('grok proxy messages', () => {
  it('defines request types and lowercase control actions', () => {
    expect(RuntimeMessage.GrokProxyRequest).toBe('GROK_PROXY_REQUEST')
    expect(GrokProxyControlAction.ListConversations).toBe('grok_web_list_conversations')
  })
})
