import { describe, expect, it } from 'vitest'
import {
  grokPrePostRetryable,
  grokPrePostStatus,
  isGrokWebPrePostControlError,
  isGrokWebRateLimitError,
} from '../src/services/clients/grok-web/pre-post-errors.mjs'

describe('isGrokWebPrePostControlError', () => {
  it('treats lock, missing tab, and inject failures as pre-POST', () => {
    expect(isGrokWebPrePostControlError(new Error('Grok Web request already in progress'))).toBe(
      true,
    )
    expect(
      isGrokWebPrePostControlError(
        new Error(
          'Grok proxy tab is unavailable. Open https://grok.com in this browser and sign in, then retry.',
        ),
      ),
    ).toBe(true)
    expect(
      isGrokWebPrePostControlError(
        new Error('Content script could not be loaded in the Grok tab.'),
      ),
    ).toBe(true)
  })

  it('does not treat post-dispatch stream failures as pre-POST', () => {
    expect(isGrokWebPrePostControlError(new Error('Grok Web request failed (500): boom'))).toBe(
      false,
    )
    expect(isGrokWebPrePostControlError(new Error('usage limit reached'))).toBe(false)
  })
})

describe('grokPrePostRetryable', () => {
  it('is retryable only after login, never after 429', () => {
    expect(grokPrePostStatus('Please login at https://grok.com first')).toBe(401)
    expect(grokPrePostRetryable('Please login at https://grok.com first')).toBe(true)
    expect(grokPrePostStatus('Grok Web request failed (429): rate limited')).toBe(429)
    expect(grokPrePostRetryable('Grok Web request failed (429): rate limited')).toBe(false)
    expect(grokPrePostStatus('previousResponseID is required')).toBe(400)
    expect(grokPrePostRetryable('previousResponseID is required')).toBe(false)
  })
})

describe('isGrokWebRateLimitError', () => {
  it('matches post-dispatch 429 messages, not other failures', () => {
    expect(isGrokWebRateLimitError(new Error('Grok Web request failed (429): rate limited'))).toBe(
      true,
    )
    expect(isGrokWebRateLimitError(new Error('Grok Web request failed (500): boom'))).toBe(false)
    expect(isGrokWebRateLimitError(new Error('Grok proxy tab is unavailable'))).toBe(false)
  })
})
