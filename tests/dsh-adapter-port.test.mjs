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

  it('carries the host home directory through the connection frame', () => {
    const prev = {
      connection: {
        status: 'connecting',
        endpoint: '',
        version: null,
        lastError: null,
        home: null,
      },
      sessions: [],
      sessionUpdates: {},
      workspaces: { items: [], archivedSessionIds: [] },
    }
    const next = applyPortMessage(prev, {
      type: 'connection',
      status: 'online',
      endpoint: 'http://127.0.0.1:3080',
      version: '0.1.0-rc.8',
      lastError: null,
      home: '/Users/alex',
    })
    expect(next.connection.home).toBe('/Users/alex')
  })
})
