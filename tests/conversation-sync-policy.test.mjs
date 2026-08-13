import { describe, expect, it } from 'vitest'

import {
  getChatgptWebHistoryAutoSyncIntervalHours,
  getChatgptWebHistoryRequestIntervalMs,
  getNextAdaptiveSyncIntervalHours,
  isChatgptWebHistoryAutoSyncAllowed,
  normalizeChatgptWebHistoryAutoSyncMode,
  resolveChatgptWebHistorySyncAlarmAction,
} from '../src/services/clients/chatgpt-web/conversation-sync-policy.mjs'

describe('ChatGPT history sync policy', () => {
  it('defaults unknown automatic modes to off', () => {
    expect(normalizeChatgptWebHistoryAutoSyncMode('surprise')).toBe('off')
  })

  it('converts RPM to an evenly-spaced minimum interval', () => {
    expect(getChatgptWebHistoryRequestIntervalMs(6)).toBe(10_000)
    expect(getChatgptWebHistoryRequestIntervalMs(30)).toBe(2_000)
    expect(getChatgptWebHistoryRequestIntervalMs(0)).toBe(10_000)
  })

  it('backs adaptive sync off from 6 to 12 to 24 hours', () => {
    expect(getNextAdaptiveSyncIntervalHours(6, false)).toBe(12)
    expect(getNextAdaptiveSyncIntervalHours(12, false)).toBe(24)
    expect(getNextAdaptiveSyncIntervalHours(24, false)).toBe(24)
    expect(getNextAdaptiveSyncIntervalHours(24, true)).toBe(6)
  })

  it('uses the configured fixed interval and adaptive metadata', () => {
    expect(
      getChatgptWebHistoryAutoSyncIntervalHours(
        { chatgptWebHistoryAutoSyncMode: 'fixed', chatgptWebHistorySyncIntervalHours: 48 },
        {},
      ),
    ).toBe(48)
    expect(
      getChatgptWebHistoryAutoSyncIntervalHours(
        { chatgptWebHistoryAutoSyncMode: 'adaptive' },
        { adaptiveSyncIntervalHours: 12 },
      ),
    ).toBe(12)
  })

  it('blocks automatic sync while disabled, off, or rate-limited', () => {
    expect(
      isChatgptWebHistoryAutoSyncAllowed({
        chatgptWebHistorySyncEnabled: true,
        chatgptWebHistoryAutoSyncMode: 'adaptive',
      }),
    ).toBe(true)
    expect(
      isChatgptWebHistoryAutoSyncAllowed({
        chatgptWebHistorySyncEnabled: false,
        chatgptWebHistoryAutoSyncMode: 'adaptive',
      }),
    ).toBe(false)
    expect(
      isChatgptWebHistoryAutoSyncAllowed(
        { chatgptWebHistorySyncEnabled: true, chatgptWebHistoryAutoSyncMode: 'adaptive' },
        { safetyLock: { reason: 'rate_limited' } },
      ),
    ).toBe(false)
  })

  it('keeps an existing one-shot alarm unless a reschedule is requested', () => {
    const existingAlarm = {
      name: 'chatgpt-web-conversation-sync',
      scheduledTime: Date.now() + 3_600_000,
    }
    expect(
      resolveChatgptWebHistorySyncAlarmAction({
        allowed: true,
        intervalHours: 12,
        existingAlarm,
        replaceExisting: false,
      }),
    ).toEqual({ action: 'keep' })
    expect(
      resolveChatgptWebHistorySyncAlarmAction({
        allowed: true,
        intervalHours: 6,
        existingAlarm,
        replaceExisting: true,
      }),
    ).toEqual({ action: 'create', delayInMinutes: 360 })
    expect(
      resolveChatgptWebHistorySyncAlarmAction({
        allowed: true,
        intervalHours: 12,
        existingAlarm: null,
        replaceExisting: false,
      }),
    ).toEqual({ action: 'create', delayInMinutes: 720 })
    expect(
      resolveChatgptWebHistorySyncAlarmAction({
        allowed: false,
        intervalHours: 12,
        existingAlarm,
        replaceExisting: false,
      }),
    ).toEqual({ action: 'clear' })
  })
})
