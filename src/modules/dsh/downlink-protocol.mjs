// Wire protocol between the dsh downlink content script and the background
// bridge (D-22).
//
// Why a content script carries the two event streams at all: the harness's
// /api trust fence refuses any request whose Origin is not the harness host —
// including WebSocket handshakes. Extension contexts stamp
// `Origin: chrome-extension://…` on every socket they open, and Chromium's
// declarativeNetRequest cannot modify WebSocket handshake headers (remove or
// set — verified against Chrome for Testing 151), so a background-opened
// socket is structurally unable to pass the fence. A content script on the
// harness origin, however, opens page-origin sockets the fence accepts.
//
// Pure data + pure helpers: imported by both the content-script bundle and
// the background bundle; no imports of its own.

/** @param {string} stream 'mux' | 'host' */
export function downlinkPath(stream) {
  return stream === 'host' ? '/api/events.host' : '/api/events.mux'
}

/** Content script → background. There is no startup announcement: the
 *  background drives discovery with Ping (the script answers Pong carrying
 *  its origin), so a service-worker restart needs no script-side state. */
export const DownlinkCsMessage = {
  Pong: 'dsh-cs-pong',
  Opened: 'dsh-cs-opened',
  Frame: 'dsh-cs-frame',
  Closed: 'dsh-cs-closed',
}

/** Background → content script (tabs.sendMessage).
 *  Ping carries `sids: string[]` of sessions the worker still owns; the
 *  script silently closes any socket not in that list (empty after an
 *  MV3 restart). Pong echoes the sids it still holds. */
export const DownlinkBgMessage = {
  Ping: 'dsh-cs-ping',
  Open: 'dsh-cs-open',
  Close: 'dsh-cs-close',
}

/** Shape test for one background→CS open request. */
export function isDownlinkOpenRequest(message) {
  return (
    message?.type === DownlinkBgMessage.Open &&
    typeof message.endpoint === 'string' &&
    typeof message.stream === 'string' &&
    typeof message.sid === 'string' &&
    typeof message.path === 'string'
  )
}
