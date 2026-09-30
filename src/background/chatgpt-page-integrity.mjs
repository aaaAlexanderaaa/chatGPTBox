import Browser from 'webextension-polyfill'
import {
  CHATGPT_WEB_INTEGRITY_RUNTIMES,
  getChatgptWebPageIntegrityInPage,
} from '../services/clients/chatgpt-web/page-integrity.mjs'
import { inspectChatgptWebRuntimeInPage } from '../services/clients/chatgpt-web/runtime-inspection.mjs'
import { resolveChatgptWebRuntimeCapabilities } from '../services/clients/chatgpt-web/runtime-capabilities.mjs'

const discovered = new Map()

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
    const target = {
      tabId: sender.tab.id,
      ...(sender.documentId ? { documentIds: [sender.documentId] } : { frameIds: [0] }),
    }
    const key = `${sender.tab.id}:${sender.documentId || ''}`
    const cached = discovered.get(key)
    const contracts = cached
      ? [
          cached,
          ...CHATGPT_WEB_INTEGRITY_RUNTIMES.filter((entry) => entry.filename !== cached.filename),
        ]
      : CHATGPT_WEB_INTEGRITY_RUNTIMES
    const results = await Browser.scripting.executeScript({
      target,
      world: 'MAIN',
      func: getChatgptWebPageIntegrityInPage,
      args: [contracts],
    })
    if (results?.[0]?.result?.code === 'CHATGPT_WEB_RUNTIME_UNSUPPORTED') {
      discovered.delete(key)
      const inspections = await Browser.scripting.executeScript({
        target,
        world: 'MAIN',
        func: inspectChatgptWebRuntimeInPage,
        args: [CHATGPT_WEB_INTEGRITY_RUNTIMES],
      })
      const contract = resolveChatgptWebRuntimeCapabilities(inspections?.[0]?.result)
      if (contract) {
        const connected = await Browser.scripting.executeScript({
          target,
          world: 'MAIN',
          func: getChatgptWebPageIntegrityInPage,
          args: [[contract]],
        })
        const result = connected?.[0]?.result
        if (result?.ok) {
          discovered.set(key, {
            ...contract,
            capabilityCheck: { ...contract.capabilityCheck, preflight: false },
          })
          if (discovered.size > 16) discovered.delete(discovered.keys().next().value)
        }
        if (result) return result
      }
      return {
        ok: false,
        code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
        message:
          'Could not identify a unique compatible ChatGPT request, account, verification and network transport. Reload the proxy tab.',
      }
    }
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
