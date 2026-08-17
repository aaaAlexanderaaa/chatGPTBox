import { describe, expect, it } from 'vitest'
import { jobsForPopover } from '../src/modules/dsh/ui/models/jobs-model.mjs'
import { childSessions } from '../src/modules/dsh/ui/models/subagent-model.mjs'
import { feedbackSubmitListed } from '../src/modules/dsh/ui/models/feedback-model.mjs'

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

describe('feedbackSubmitListed', () => {
  it('detects feedback.submit from name, line, or id (with optional slash)', () => {
    expect(feedbackSubmitListed([{ name: 'feedback.submit' }])).toBe(true)
    expect(feedbackSubmitListed([{ line: '/feedback.submit' }])).toBe(true)
    expect(feedbackSubmitListed([{ id: 'feedback.submit' }])).toBe(true)
    expect(feedbackSubmitListed(['/feedback.submit'])).toBe(true)
  })

  it('returns false when the command is absent or list is empty', () => {
    expect(feedbackSubmitListed([])).toBe(false)
    expect(feedbackSubmitListed([{ name: 'other' }])).toBe(false)
    expect(feedbackSubmitListed(null)).toBe(false)
    expect(feedbackSubmitListed(undefined)).toBe(false)
  })
})
