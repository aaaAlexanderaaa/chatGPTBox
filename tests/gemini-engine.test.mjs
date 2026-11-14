import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config/storage.mjs'
import {
  enabledGeminiWebSelections,
  normalizeL1Providers,
  resolveEngine,
} from '../src/config/engine-selection.mjs'
import {
  GEMINI_WEB_MODEL,
  GEMINI_WEB_SELECTION,
  geminiWebConversationUrl,
} from '../src/config/gemini-web.mjs'
import { clearSessionConversation, switchSessionEngine } from '../src/services/session-binding.mjs'
import { isGeminiEngineKey, slugToModelKey } from '../src/pages/ApiServer/model-slug.mjs'
import { detectExecutionRoute } from '../src/background/providers/registry.mjs'

describe('Gemini engine integration', () => {
  it('is default-off and advertises only the checked 4 Hydrogen / High adapter', () => {
    expect(defaultConfig.geminiWebEnabled).toBe(false)
    expect(enabledGeminiWebSelections({ geminiWebEnabled: true })).toEqual([])
    expect(enabledGeminiWebSelections({ geminiWebEnabled: false, geminiWebReady: true })).toEqual(
      [],
    )
    expect(
      enabledGeminiWebSelections({ geminiWebEnabled: true, geminiWebReady: true }).map(
        (row) => row.value,
      ),
    ).toEqual([GEMINI_WEB_SELECTION])
    expect(resolveEngine({ modelName: GEMINI_WEB_SELECTION }).kind).toBe('gemini-web')
    expect(
      detectExecutionRoute({ modelName: GEMINI_WEB_SELECTION }, { geminiWebEnabled: true }),
    ).toBe('gemini-web')
    expect(detectExecutionRoute({ modelName: GEMINI_WEB_SELECTION }, {})).toBe('unknown')
    expect(normalizeL1Providers([{ id: 'geminiweb', models: [] }])[0].id).not.toBe('geminiweb')
  })

  it('never turns an explicit Gemini model into a ChatGPT request', () => {
    expect(slugToModelKey(GEMINI_WEB_MODEL)).toBe(GEMINI_WEB_SELECTION)
    expect(slugToModelKey(GEMINI_WEB_SELECTION)).toBe(GEMINI_WEB_SELECTION)
    expect(slugToModelKey('gemini-unknown')).toBe('geminiweb/gemini-unknown')
    expect(isGeminiEngineKey(GEMINI_WEB_SELECTION)).toBe(true)
    expect(isGeminiEngineKey('chatgptweb/gpt-6-thinking')).toBe(false)
  })

  it('clears Gemini native document bindings on clear and cross-provider switches', () => {
    const session = {
      sessionId: 'local',
      modelName: GEMINI_WEB_SELECTION,
      conversationId: 'c_site',
      geminiWebTabId: 1,
      geminiWebOwnerId: 'owner',
      geminiWebDocumentId: 'document',
      geminiWebLastNativeId: 'native',
      geminiWebUrl: 'https://gemini.google.com/app/site',
      conversationRecords: [{ question: 'q', answer: 'a' }],
    }
    for (const next of [
      clearSessionConversation(session),
      switchSessionEngine(session, 'chatgptweb/gpt-6-thinking'),
    ]) {
      expect(next.conversationId).toBeNull()
      expect(next.geminiWebTabId).toBeNull()
      expect(next.geminiWebOwnerId).toBeNull()
      expect(next.geminiWebDocumentId).toBeNull()
      expect(next.geminiWebLastNativeId).toBeNull()
      expect(next.geminiWebUrl).toBeNull()
    }
  })

  it('opens only safe Gemini conversation URLs from imported session metadata', () => {
    expect(
      geminiWebConversationUrl({
        geminiWebUrl: 'https://gemini.google.com/app/known?token=private#extra',
      }),
    ).toBe('https://gemini.google.com/app/known')
    for (const geminiWebUrl of [
      'javascript:alert(1)',
      'https://gemini.google.com.evil.invalid/app/known',
      'https://gemini.google.com/settings',
      'https://evil.invalid/app',
    ])
      expect(geminiWebConversationUrl({ geminiWebUrl })).toBe('https://gemini.google.com/app')
  })
})
