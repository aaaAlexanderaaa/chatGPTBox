import { describe, expect, it } from 'vitest'
import { Models } from '../src/config/models.mjs'
import {
  CHATGPT_WEB_REALTIME_PREFIX,
  CHATGPT_WEB_VOICE_MODE_WINGMAN,
  CHATGPT_WEB_WINGMAN_DISPLAY_FALLBACK,
  chatgptWebRealtimePath,
  chatgptWebVoiceTelemetryName,
} from '../src/services/clients/chatgpt-web/voice.mjs'

describe('chatgpt-web voice fragments', () => {
  it('does not invent a gpt-live-1 conversation slug', () => {
    expect(Models.chatgptWebLive1).toBeUndefined()
    expect(Object.values(Models).some((model) => model.value === 'gpt-live-1')).toBe(false)
  })

  it('matches the concatenated realtime paths in the current bundles', () => {
    expect(CHATGPT_WEB_WINGMAN_DISPLAY_FALLBACK).toBe('GPT Live 1')
    expect(chatgptWebVoiceTelemetryName(CHATGPT_WEB_VOICE_MODE_WINGMAN)).toBe('bidi')
    expect(chatgptWebRealtimePath(CHATGPT_WEB_VOICE_MODE_WINGMAN, 'wm')).toBe(
      `${CHATGPT_WEB_REALTIME_PREFIX}/wm`,
    )
    expect(chatgptWebRealtimePath('advanced', 'vp')).toBe(`${CHATGPT_WEB_REALTIME_PREFIX}/vp`)
    expect(chatgptWebRealtimePath('standard', 'vp')).toBe(`${CHATGPT_WEB_REALTIME_PREFIX}/vps`)
  })
})
