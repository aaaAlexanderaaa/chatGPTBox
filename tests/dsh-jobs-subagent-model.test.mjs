import { describe, expect, it } from 'vitest'
import { jobsForPopover } from '../src/modules/dsh/ui/models/jobs-model.mjs'
import { childSessions } from '../src/modules/dsh/ui/models/subagent-model.mjs'

describe('jobsForPopover', () => {
  it('badges live jobs and sorts settled newest finished first', () => {
    const { live, settled, badge } = jobsForPopover([
      { id: 'a', status: 'running', startedAt: 20 },
      { id: 'b', status: 'ok', startedAt: 1, finishedAt: 5 },
      { id: 'c', status: 'ok', startedAt: 2, finishedAt: 9 },
      { id: 'd', status: 'stopping', startedAt: 10 },
    ])
    expect(badge).toBe(2)
    expect(live.map((j) => j.id)).toEqual(['d', 'a'])
    expect(settled.map((j) => j.id)).toEqual(['c', 'b'])
  })

  it('hides the popover data when there are no jobs', () => {
    expect(jobsForPopover([]).badge).toBe(0)
  })
})

describe('childSessions', () => {
  it('returns subagent children of one parent', () => {
    const rows = childSessions('p', [
      { sessionId: 'c1', origin: 'subagent', parentSessionId: 'p' },
      { sessionId: 'c2', origin: 'subagent', parentSessionId: 'other' },
      { sessionId: 'fork', origin: 'fork', parentSessionId: 'p' },
    ])
    expect(rows.map((s) => s.sessionId)).toEqual(['c1'])
  })
})
