import Browser from 'webextension-polyfill'
import {
  CHATGPT_WEB_INTEGRITY_RUNTIMES,
  getChatgptWebPageIntegrityInPage,
} from '../services/clients/chatgpt-web/page-integrity.mjs'

export async function getChatgptWebPageIntegrityForSender(sender) {
  const denied = {
    ok: false,
    code: 'CHATGPT_WEB_PAGE_REQUIRED',
    message: 'Request verification must originate from the top-level ChatGPT page.',
  }
  try {
    if (
      sender?.id !== Browser.runtime.id ||
      sender.frameId !== 0 ||
      !Number.isInteger(sender.tab?.id) ||
      new URL(sender.url).origin !== 'https://chatgpt.com'
    )
      return denied
  } catch {
    return denied
  }
  try {
    const results = await Browser.scripting.executeScript({
      target: {
        tabId: sender.tab.id,
        ...(sender.documentId ? { documentIds: [sender.documentId] } : { frameIds: [0] }),
      },
      world: 'MAIN',
      func: getChatgptWebPageIntegrityInPage,
      args: [CHATGPT_WEB_INTEGRITY_RUNTIMES],
    })
    return (
      results?.[0]?.result || {
        ok: false,
        code: 'CHATGPT_WEB_INTEGRITY_UNAVAILABLE',
        message: 'The ChatGPT page did not return a verification result.',
      }
    )
  } catch {
    return {
      ok: false,
      code: 'CHATGPT_WEB_INTEGRITY_UNAVAILABLE',
      message: 'Could not access the ChatGPT page runtime. Reload the extension and proxy tab.',
    }
  }
}
