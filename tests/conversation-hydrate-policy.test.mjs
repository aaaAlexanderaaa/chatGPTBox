import { describe, expect, it } from 'vitest'
import {
  buildHydrateCandidateIds,
  canResumeHydrateState,
  decideHydrateAction,
  hydrateJobFingerprint,
  isHydrateAuthStopStatus,
  isHydrateCircuitOpen,
  listHydrateFailures,
  needsHydrateConversationBody,
  nextHydrateConsecutiveFailures,
  normalizeHydrateOrder,
  resolveHydrateBulkStart,
  shouldSkipHydrateFailure,
  sortHydrateIndexEntries,
} from '../src/services/clients/chatgpt-web/conversation-hydrate-policy.mjs'

function entry(id, extras = {}) {
  return {
    id,
    title: id,
    createTime: extras.createTime ?? 1,
    updateTime: extras.updateTime ?? 2,
    isArchived: extras.isArchived === true,
  }
}

describe('conversation hydrate policy', () => {
  it('normalizes unknown orders to updated desc', () => {
    expect(normalizeHydrateOrder('nope')).toBe('updated')
    expect(normalizeHydrateOrder('created_asc')).toBe('created_asc')
  })

  it('sorts earliest created first without including archived by default', () => {
    const sorted = sortHydrateIndexEntries(
      {
        new: entry('new', { createTime: 30, updateTime: 90 }),
        old: entry('old', { createTime: 10, updateTime: 80 }),
        archived: entry('archived', { createTime: 1, isArchived: true }),
      },
      { order: 'created_asc' },
    )
    expect(sorted.map((item) => item.id)).toEqual(['old', 'new'])
  })

  it('applies offset when building candidate ids', () => {
    const ids = buildHydrateCandidateIds(
      {
        a: entry('a', { updateTime: 3 }),
        b: entry('b', { updateTime: 2 }),
        c: entry('c', { updateTime: 1 }),
      },
      { order: 'updated', offset: 1 },
    )
    expect(ids).toEqual(['b', 'c'])
  })

  it('fetches missing or newer bodies and skips remembered failures', () => {
    expect(decideHydrateAction({ needsBody: true, skippedFailure: true })).toBe('skip_failed')
    expect(decideHydrateAction({ needsBody: false, skippedFailure: false })).toBe('skip_fresh')
    expect(decideHydrateAction({ needsBody: true, skippedFailure: false })).toBe('fetch')
    expect(shouldSkipHydrateFailure({ conversationId: 'a', skipped: true })).toBe(true)
    expect(shouldSkipHydrateFailure({ conversationId: 'a', skipped: false })).toBe(false)
  })

  it('only treats a cached body as needing hydrate when the list updateTime is newer', () => {
    const snapshot = {
      updateTime: 10,
      snapshot: { conversation_id: 'a', update_time: 10 },
    }
    expect(needsHydrateConversationBody({ updateTime: 10 }, snapshot)).toBe(false)
    expect(needsHydrateConversationBody({ updateTime: 11 }, snapshot)).toBe(true)
    expect(
      needsHydrateConversationBody({ updateTime: 10, asyncStatus: 'in_progress' }, snapshot),
    ).toBe(false)
    expect(needsHydrateConversationBody({ updateTime: 10 }, null)).toBe(true)
  })

  it('never treats a mismatched Resume as a new crawl', () => {
    const state = {
      status: 'paused',
      order: 'updated',
      offset: 0,
      limit: 0,
      includeArchived: false,
      candidateIds: ['a'],
    }
    const options = {
      order: 'updated',
      offset: 0,
      limit: 0,
      includeArchived: false,
    }
    expect(resolveHydrateBulkStart({ resume: true, state, options })).toBe('restore')
    expect(
      resolveHydrateBulkStart({
        resume: true,
        state,
        options: { ...options, order: 'created_asc' },
      }),
    ).toBe('reject')
    expect(resolveHydrateBulkStart({ resume: false, state, options })).toBe('start')
    expect(
      resolveHydrateBulkStart({
        resume: false,
        state: { ...state, status: 'circuit_open' },
        options,
      }),
    ).toBe('circuit')
  })

  it('opens the circuit after five consecutive conversation failures', () => {
    expect(nextHydrateConsecutiveFailures(4, false)).toBe(5)
    expect(isHydrateCircuitOpen(5)).toBe(true)
    expect(nextHydrateConsecutiveFailures(5, true)).toBe(0)
  })

  it('stops the job on 401/403 but not on ordinary 500s', () => {
    expect(isHydrateAuthStopStatus(401)).toBe(true)
    expect(isHydrateAuthStopStatus(403)).toBe(true)
    expect(isHydrateAuthStopStatus(500)).toBe(false)
  })

  it('resumes only when the job fingerprint and stored candidate ids match', () => {
    const options = hydrateJobFingerprint({
      order: 'created_asc',
      offset: 0,
      limit: 100,
      includeArchived: false,
    })
    expect(
      canResumeHydrateState({ ...options, status: 'paused', candidateIds: ['a'] }, options),
    ).toBe(true)
    expect(
      canResumeHydrateState(
        { ...options, status: 'paused', candidateIds: ['a'] },
        { ...options, order: 'updated' },
      ),
    ).toBe(false)
  })

  it('lists failures with the conversation id first-class and newest error first', () => {
    const listed = listHydrateFailures({
      old: { conversationId: 'old', failedAt: '2026-01-01T00:00:00.000Z', title: 'Old' },
      fresh: { conversationId: 'fresh', failedAt: '2026-02-01T00:00:00.000Z', title: 'Fresh' },
    })
    expect(listed.map((entry) => entry.conversationId)).toEqual(['fresh', 'old'])
  })
})
