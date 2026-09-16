import { describe, expect, it } from 'vitest'

import {
  createHistoryRequestWindow,
  getChatgptWebHistoryAutoSyncIntervalHours,
  getChatgptWebHistoryRequestIntervalMs,
  getNextAdaptiveSyncIntervalHours,
  isChatgptWebHistoryAutoSyncAllowed,
  normalizeChatgptWebHistoryAutoSyncMode,
  planHistoryRequestSlot,
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

  it('picks RPM timestamps uniformly in the minute and sorts them', () => {
    const samples = [0.9, 0.1, 0.4, 0.2, 0.8, 0.3]
    let cursor = 0
    const random = () => samples[cursor++]
    const window = createHistoryRequestWindow(6, { now: 1_000_000, random })
    expect(window.offsets).toEqual([6_000, 12_000, 18_000, 24_000, 48_000, 54_000])

    cursor = 0
    const first = planHistoryRequestSlot(null, 6, { now: 1_000_000, random })
    expect(first.fireAt).toBe(1_000_000 + 6_000)
    const second = planHistoryRequestSlot(first.schedule, 6, { now: first.fireAt, random })
    expect(second.fireAt).toBe(1_000_000 + 12_000)
  })

  it('does not catch up missed slots in a burst', () => {
    const startedAt = new Date(1_000_000).toISOString()
    const planned = planHistoryRequestSlot(
      { startedAt, offsets: [1_000, 11_000, 21_000, 31_000, 41_000, 51_000], index: 0 },
      6,
      { now: 1_000_000 + 25_000 },
    )
    expect(planned.fireAt).toBe(1_000_000 + 31_000)
    expect(planned.schedule.index).toBe(4)
  })

  it('waits for the current minute to end before opening the next RPM window', () => {
    const origin = 1_000_000
    const planned = planHistoryRequestSlot(
      {
        startedAt: new Date(origin).toISOString(),
        offsets: [1_000, 2_000, 3_000, 4_000, 5_000, 9_000],
        index: 6,
      },
      6,
      { now: origin + 9_000, random: () => 0.1 },
    )
    expect(planned.fireAt).toBe(origin + 60_000 + 6_000)
    expect(Date.parse(planned.schedule.startedAt)).toBe(origin + 60_000)
  })

  it('starts a new window immediately once the previous minute has expired', () => {
    const origin = 1_000_000
    const planned = planHistoryRequestSlot(
      {
        startedAt: new Date(origin).toISOString(),
        offsets: [1_000],
        index: 1,
      },
      1,
      { now: origin + 70_000, random: () => 0.1 },
    )
    expect(planned.fireAt).toBe(origin + 70_000 + 6_000)
    expect(Date.parse(planned.schedule.startedAt)).toBe(origin + 70_000)
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
