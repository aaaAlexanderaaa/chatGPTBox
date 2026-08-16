import {
  acquireGrokWebSessionLock,
  ensureGrokProxyTab,
  sendGrokProxyRequest,
} from '../../background/grok-proxy-service.mjs'

export async function generateAnswersWithGrokWebApi({ port, session, config }) {
  if (config.grokWebSignedIn !== true) {
    throw new Error('Please login at https://grok.com first')
  }

  const release = acquireGrokWebSessionLock(session, port)
  if (release === null) return

  try {
    const tab = await ensureGrokProxyTab()
    if (!tab?.id) {
      throw new Error('Unable to open a dedicated Grok proxy tab')
    }
    await sendGrokProxyRequest(tab.id, session, port)
  } finally {
    release()
  }
}
