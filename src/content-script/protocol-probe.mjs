// Collect script URLs when the background asks. Does not watch the page.

import { findProtocolProbeSpecForUrl } from '../services/protocol-probe/specs.mjs'
import { collectPageScriptSnapshot } from '../services/protocol-probe/collect.mjs'

export function collectProtocolProbeSnapshotPayload(trigger = 'collect_request') {
  const spec = findProtocolProbeSpecForUrl(location.href)
  if (!spec) return null
  const snapshot = collectPageScriptSnapshot()
  return {
    specId: spec.id,
    trigger,
    pageUrl: snapshot.pageUrl,
    hostname: snapshot.hostname,
    scripts: snapshot.scripts,
  }
}
