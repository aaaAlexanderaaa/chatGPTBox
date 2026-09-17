// Extension-page sender trust check.
//
// Used by the API Bridge WebSocket proxy to refuse content-script ports.
// The FETCH runtime-message proxy that used to live here has been removed.

import Browser from 'webextension-polyfill'

const extensionOrigin = new URL(Browser.runtime.getURL('/')).origin

export function isExtensionPageSender(sender) {
  if (!sender) return false
  if (sender.id && sender.id !== Browser.runtime.id) return false
  // Content scripts have sender.tab set to the host tab; extension pages do not have
  // a tab origin matching the extension. Also accept sender.url that lives on the
  // extension origin (popup/options/IndependentPanel/ApiServer pages).
  const url = sender.url
  if (!url) return false
  try {
    return new URL(url).origin === extensionOrigin
  } catch {
    return false
  }
}
