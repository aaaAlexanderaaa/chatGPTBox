import Browser from 'webextension-polyfill'
import {
  acquireGrokWebSessionLock,
  ensureGrokProxyTab,
  sendGrokProxyRequest,
} from '../../background/grok-proxy-service.mjs'

const GROK_COOKIE_URL = 'https://grok.com/'

export async function generateAnswersWithGrokWebApi({ port, session, config }, deps = {}) {
  if (config.grokWebSignedIn !== true) {
    const getCookies = deps.getCookies || (() => Browser.cookies.getAll({ url: GROK_COOKIE_URL }))
    const cookies = await getCookies().catch(() => [])
    if (!Array.isArray(cookies) || cookies.length === 0) {
      throw new Error('Please login at https://grok.com first')
    }
  }

  const release = acquireGrokWebSessionLock(session, port)
  if (release === null) return

  const send = deps.sendGrokProxyRequest || sendGrokProxyRequest
  try {
    const tab = await ensureGrokProxyTab(deps)
    if (!tab?.id) {
      throw new Error('Unable to open a dedicated Grok proxy tab')
    }
    await send(tab.id, session, port, deps)
  } finally {
    release()
  }
}
