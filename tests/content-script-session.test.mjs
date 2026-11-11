import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
const source = readFileSync(new URL('../src/content-script/index.jsx', import.meta.url), 'utf8')
const start = source.indexOf('async function overwriteAccessToken()')
const end = source.indexOf('\nasync function prepareForForegroundRequests()', start)
const code = source.slice(start, end)
const run = async (enabled, host = 'chatgpt.com') => {
  const fetch = vi.fn(async () => ({ json: async () => ({ accessToken: 'synthetic-only' }) })),
    setAccessToken = vi.fn(),
    setUserConfig = vi.fn()
  const context = vm.createContext({
    location: { hostname: host, pathname: '/' },
    getUserConfig: async () => ({ chatgptWebEnabled: enabled }),
    fetch,
    setAccessToken,
    setUserConfig,
    window: { localStorage: { refresh_token: 'synthetic-kimi' } },
    console,
  })
  await new vm.Script(code + '\noverwriteAccessToken()').runInContext(context)
  return { fetch, setAccessToken, setUserConfig }
}
describe('site enhancements do not bootstrap a disabled ChatGPT provider', () => {
  it('performs no authentication request or token write when the engine is off', async () => {
    const s = await run(false)
    expect(s.fetch).not.toHaveBeenCalled()
    expect(s.setAccessToken).not.toHaveBeenCalled()
  })
  it('preserves explicit engine-enabled authentication and the unrelated Kimi capture', async () => {
    const s = await run(true)
    expect(s.fetch).toHaveBeenCalledTimes(1)
    expect(s.setAccessToken).toHaveBeenCalledWith('synthetic-only')
    const other = await run(false, 'kimi.com')
    expect(other.fetch).not.toHaveBeenCalled()
    expect(other.setUserConfig).toHaveBeenCalledWith({ kimiMoonShotRefreshToken: 'synthetic-kimi' })
  })
})

it.each(['authentication', 'provider'])(
  'classifies only an initial %s failure as unsent',
  async (phase) => {
    const start = source.indexOf('async function handleChatgptProxyRequest(')
    const end = source.indexOf('\nasync function ensureChatgptAccessToken()', start)
    const observed = []
    const failure = new Error('Synthetic failure')
    const context = vm.createContext({
      location: { hostname: 'chatgpt.com' },
      Browser: { runtime: { connect: () => ({ disconnect() {} }) } },
      ensureChatgptAccessToken: async () => {
        if (phase === 'authentication') throw failure
        return 'synthetic-token'
      },
      isUsingChatgptWebModel: () => true,
      generateAnswersWithChatgptWebApi: async () => {
        throw failure
      },
      handlePortError: (_session, _port, error) => observed.push(error),
    })
    await new vm.Script(
      source.slice(start, end) +
        '\nhandleChatgptProxyRequest({ question: "Synthetic" }, "request")',
    ).runInContext(context)
    expect(observed).toHaveLength(1)
    expect(observed[0].chatgptWebNotDispatched).toBe(phase === 'authentication' ? true : undefined)
  },
)

const background = readFileSync(new URL('../src/background/index.mjs', import.meta.url), 'utf8')
const bgStart = background.indexOf('async function ensureChatgptWebFirstRun()')
const bgEnd = background.indexOf('// --- conversation sync', bgStart)
it('does not probe the disabled ChatGPT engine on extension install/startup', async () => {
  const fetch = vi.fn()
  const context = vm.createContext({
    getUserConfig: async () => ({ chatgptWebEnabled: false }),
    isUsingChatgptWebModel: () => true,
    fetch,
    console,
  })
  await new vm.Script(
    background.slice(bgStart, bgEnd) + '\nensureChatgptWebFirstRun()',
  ).runInContext(context)
  expect(fetch).not.toHaveBeenCalled()
})
