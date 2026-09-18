import { describe, expect, it } from 'vitest'
import { shouldHandleInputAction } from '../src/utils/should-handle-input-action.mjs'

describe('shouldHandleInputAction', () => {
  it('always handles click', () => {
    expect(shouldHandleInputAction({ type: 'click' })).toBe(true)
    expect(
      shouldHandleInputAction({ type: 'click', isComposing: true, keyCode: 229, shiftKey: true }),
    ).toBe(true)
  })

  it('handles a normal Enter', () => {
    expect(shouldHandleInputAction({ type: 'keydown', key: 'Enter', keyCode: 13 })).toBe(true)
    expect(shouldHandleInputAction({ type: 'keydown', key: 'Enter' })).toBe(true)
    expect(shouldHandleInputAction({ type: 'keydown', keyCode: 13 })).toBe(true)
  })

  it('ignores Shift+Enter so it can insert a newline', () => {
    expect(
      shouldHandleInputAction({ type: 'keydown', key: 'Enter', keyCode: 13, shiftKey: true }),
    ).toBe(false)
  })

  it('ignores Enter while composing (macOS IME)', () => {
    expect(
      shouldHandleInputAction({ type: 'keydown', key: 'Enter', keyCode: 13, isComposing: true }),
    ).toBe(false)
    expect(
      shouldHandleInputAction({
        type: 'keydown',
        key: 'Enter',
        keyCode: 13,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false)
  })

  it('ignores keyCode 229 (Windows IME)', () => {
    expect(shouldHandleInputAction({ type: 'keydown', key: 'Enter', keyCode: 229 })).toBe(false)
    expect(shouldHandleInputAction({ type: 'keydown', keyCode: 229 })).toBe(false)
  })
})
