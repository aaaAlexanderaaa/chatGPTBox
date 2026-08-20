import { describe, expect, it } from 'vitest'
import { shouldPullWorkspaces } from '../src/modules/dsh/background/workspace-frames.mjs'

describe('shouldPullWorkspaces', () => {
  it('pulls on live host workspace frames, not the invented workspace-added names', () => {
    expect(shouldPullWorkspaces('host/workspace-changed')).toBe(true)
    expect(shouldPullWorkspaces('host/workspace-removed')).toBe(true)
    expect(shouldPullWorkspaces('host/workspace-order-changed')).toBe(true)
    expect(shouldPullWorkspaces('host/archived-sessions-changed')).toBe(true)
    expect(shouldPullWorkspaces('workspace-added')).toBe(false)
    expect(shouldPullWorkspaces('host/session-added')).toBe(false)
  })
})
