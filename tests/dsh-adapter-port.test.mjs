import { describe, expect, it } from 'vitest'
import { applyPortMessage } from '../src/modules/dsh/ui/adapter/port-state.mjs'

describe('applyPortMessage', () => {
  it('replaces the workspace snapshot', () => {
    const prev = {
      connection: { status: 'online' },
      sessions: [],
      sessionUpdates: {},
      workspaces: { items: [], archivedSessionIds: [] },
    }
    const next = applyPortMessage(prev, {
      type: 'workspaces',
      items: [{ workspaceId: 'w1' }],
      archivedSessionIds: ['s9'],
    })
    expect(next.workspaces).toEqual({
      items: [{ workspaceId: 'w1' }],
      archivedSessionIds: ['s9'],
    })
  })
})
