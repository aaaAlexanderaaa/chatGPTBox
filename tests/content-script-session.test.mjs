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
