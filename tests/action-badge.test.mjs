import { describe, expect, it, vi } from 'vitest'
import { applyActionBadge, resolveActionBadge } from '../src/background/action-badge.mjs'

describe('resolveActionBadge', () => {
  it('lets a pending dsh approval win over a ChatGPT 429 lock', () => {
    expect(resolveActionBadge({ dshWaiting: 2, rateLimited: true })).toEqual({
      text: '2',
      color: '#d97706',
    })
  })

  it('shows 429 only when nothing is waiting', () => {
    expect(resolveActionBadge({ dshWaiting: 0, rateLimited: true })).toEqual({
      text: '429',
      color: '#b91c1c',
    })
  })

  it('clears the badge when neither signal is active', () => {
    expect(resolveActionBadge({ dshWaiting: 0, rateLimited: false })).toEqual({
      text: '',
      color: null,
    })
  })
})

describe('applyActionBadge', () => {
  it('clears a stale background color when the badge text goes empty', () => {
    const action = {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
    }
    applyActionBadge(action, { text: '', color: null })
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' })
    expect(action.setBadgeBackgroundColor).toHaveBeenCalled()
  })
})
