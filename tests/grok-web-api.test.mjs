import { describe, expect, it } from 'vitest'
import { generateAnswersWithGrokWebApi } from '../src/services/apis/grok-web.mjs'

function silentPort() {
  return {
    postMessage() {},
    onMessage: { addListener() {}, removeListener() {} },
    onDisconnect: { addListener() {} },
  }
}

describe('generateAnswersWithGrokWebApi', () => {
  it('fails fast when signed out and grok.com has no cookies', async () => {
    let queried = false
    await expect(
      generateAnswersWithGrokWebApi(
        {
          port: silentPort(),
          session: { sessionId: 's', question: 'hi', modelName: 'grokWebFast' },
          config: { grokWebSignedIn: false },
        },
        {
          getCookies: async () => [],
          tabs: {
            query: async () => {
              queried = true
              return []
            },
          },
        },
      ),
    ).rejects.toThrow(/Please login at https:\/\/grok\.com first/)
    expect(queried).toBe(false)
  })

  it('hard-confirms via the proxy tab when signed-out but cookies remain', async () => {
    let queried = false
    let sent = false
    await generateAnswersWithGrokWebApi(
      {
        port: silentPort(),
        session: { sessionId: 's', question: 'hi', modelName: 'grokWebFast' },
        config: { grokWebSignedIn: false },
      },
      {
        getCookies: async () => [{ name: 'sso', value: 'x' }],
        tabs: {
          query: async () => {
            queried = true
            return [{ id: 1, url: 'https://grok.com/?chatgptbox_proxy=1' }]
          },
        },
        sendGrokProxyRequest: async () => {
          sent = true
        },
      },
    )
    expect(queried).toBe(true)
    expect(sent).toBe(true)
  })
})
