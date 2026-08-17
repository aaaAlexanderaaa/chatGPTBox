import { describe, expect, it } from 'vitest'
import {
  canCompose,
  groupSessionsForSidebar,
  isSubagentSession,
} from '../src/modules/dsh/ui/models/sidebar-model.mjs'

const wsA = { workspaceId: 'w1', title: 'repo-a', path: '/a', sessionIds: ['s1', 's2'] }
const s1 = { sessionId: 's1', title: 'one', origin: 'local-new' }
const s2 = { sessionId: 's2', title: 'two', origin: 'local-new' }
const child = { sessionId: 's3', title: 'child', origin: 'subagent' }
const stray = { sessionId: 's9', title: 'loose', origin: 'local-new' }

describe('sidebar-model', () => {
  it('hides subagent-origin rows from the sidebar', () => {
    expect(isSubagentSession(child)).toBe(true)
    const { groups, ungrouped } = groupSessionsForSidebar({
      workspaces: [wsA],
      sessions: [s1, s2, child, stray],
      archivedSessionIds: [],
    })
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['s1', 's2'])
    expect(ungrouped.map((s) => s.sessionId)).toEqual(['s9'])
  })

  it('hides archived sessions in every group', () => {
    const { groups, ungrouped } = groupSessionsForSidebar({
      workspaces: [wsA],
      sessions: [s1, s2, stray],
      archivedSessionIds: ['s2', 's9'],
    })
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['s1'])
    expect(ungrouped).toEqual([])
  })

  it('keeps workspace order and sessionIds order', () => {
    const { groups } = groupSessionsForSidebar({
      workspaces: [wsA],
      sessions: [s2, s1],
      archivedSessionIds: [],
    })
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['s1', 's2'])
  })

  it('forbids compose without a selected workspace', () => {
    expect(canCompose({ workspaceCount: 0, selectedWorkspaceId: null })).toBe(false)
    expect(canCompose({ workspaceCount: 2, selectedWorkspaceId: null })).toBe(false)
    expect(canCompose({ workspaceCount: 1, selectedWorkspaceId: 'w1' })).toBe(true)
  })
})
