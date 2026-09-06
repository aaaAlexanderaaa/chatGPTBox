import { describe, expect, it } from 'vitest'
import {
  classifyChatgptWebModelsPayload,
  collectChatgptWebModelSlugs,
  mergeChatgptWebModelCatalogs,
} from '../src/services/clients/chatgpt-web/catalog.mjs'

const CHAT_LATEST = {
  title: 'Latest',
  secondary_title: 'GPT-5.6 Sol',
  default_model_slug: 'gpt-5-6',
  models: [
    { slug: 'gpt-5-6', reasoning_type: 'auto', is_work_mode_model: false },
    { slug: 'gpt-5-6-instant', reasoning_type: 'none', is_work_mode_model: false },
    { slug: 'gpt-5-6-thinking', reasoning_type: 'reasoning', is_work_mode_model: false },
    { slug: 'gpt-6-pro', reasoning_type: 'pro', is_work_mode_model: false },
    { slug: 'gpt-6-astra-wm', reasoning_type: 'reasoning', is_work_mode_model: true },
  ],
  versions: [
    {
      id: 'latest',
      slugs: ['gpt-5-6', 'gpt-5-6-instant', 'gpt-5-6-thinking', 'gpt-6-pro'],
    },
  ],
}

const WORK_TPP = {
  title: 'ChatGPT',
  secondary_title: '',
  default_model_slug: 'gpt-5.6-sol-wm',
  models: [
    {
      slug: 'gpt-6-astra-wm',
      is_work_mode_model: true,
      default_thinking_effort: 'min',
    },
    {
      slug: 'gpt-5.6-sol-wm',
      is_work_mode_model: true,
      default_thinking_effort: 'min',
    },
  ],
}

describe('chatgpt-web model catalogs', () => {
  it('treats Latest as Chat and keeps gpt-6-pro out of Work', () => {
    const catalog = classifyChatgptWebModelsPayload(CHAT_LATEST)
    expect(catalog.kind).toBe('chat')
    expect(catalog.chatSlugs).toContain('gpt-6-pro')
    expect(catalog.chatSlugs).toContain('gpt-5-6')
    expect(catalog.chatSlugs).not.toContain('gpt-6-astra-wm')
    expect(catalog.workSlugs).toEqual(['gpt-6-astra-wm'])
  })

  it('treats the default_thinking_effort catalog as Work, not Chat GPT-6', () => {
    const catalog = classifyChatgptWebModelsPayload(WORK_TPP)
    expect(catalog.kind).toBe('work')
    expect(catalog.chatSlugs).toEqual([])
    expect(catalog.workSlugs).toEqual(['gpt-6-astra-wm', 'gpt-5.6-sol-wm'])
    expect(catalog.slugs).not.toContain('gpt-6-pro')
  })

  it('merges both official /models requests without promoting Work to Chat', () => {
    const merged = mergeChatgptWebModelCatalogs(CHAT_LATEST, WORK_TPP)
    expect(merged.chatSlugs).toContain('gpt-6-pro')
    expect(merged.chatSlugs).not.toContain('gpt-6-astra-wm')
    expect(merged.workSlugs).toEqual(expect.arrayContaining(['gpt-6-astra-wm', 'gpt-5.6-sol-wm']))
    expect(collectChatgptWebModelSlugs(CHAT_LATEST)).toContain('gpt-6-pro')
  })

  it('does not treat a Work-only payload as the Chat catalog', () => {
    const merged = mergeChatgptWebModelCatalogs(WORK_TPP, null)
    expect(merged.catalogs.chat.kind).toBe('work')
    expect(merged.chatSlugs).toEqual([])
    expect(merged.workSlugs).toEqual(['gpt-6-astra-wm', 'gpt-5.6-sol-wm'])
  })
})
