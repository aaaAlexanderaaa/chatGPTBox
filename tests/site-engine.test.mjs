import { describe, expect, it } from 'vitest'
import { matchSiteName, resolveEngineForSite } from '../src/utils/site-engine.mjs'

// Roadmap C3 / D-14: per-site engine assignment is a site rule. These are
// the pure resolvers both the content script and the settings UI rely on.

describe('matchSiteName', () => {
  const siteKeys = ['google', 'github', 'mp.weixin.qq']

  it('matches built-in adapter keys with word boundaries', () => {
    expect(matchSiteName({}, 'www.google.com', siteKeys)).toBe('google')
    expect(matchSiteName({}, 'github.com', siteKeys)).toBe('github')
    expect(matchSiteName({}, 'example.com', siteKeys)).toBeNull()
    expect(matchSiteName({}, 'notgithub.com', siteKeys)).toBeNull()
  })

  it('prefers a custom regex when it matches', () => {
    expect(matchSiteName({ siteRegex: 'intranet' }, 'intranet.corp', siteKeys)).toBe('intranet')
    expect(matchSiteName({ siteRegex: 'nomatch' }, 'www.google.com', siteKeys)).toBe('google')
  })

  it('a broken regex falls through to built-in rules instead of throwing', () => {
    expect(matchSiteName({ siteRegex: '(' }, 'www.google.com', siteKeys)).toBe('google')
  })

  it('useSiteRegexOnly disables built-in matching entirely', () => {
    expect(
      matchSiteName({ siteRegex: 'intranet', useSiteRegexOnly: true }, 'www.google.com', siteKeys),
    ).toBeNull()
    expect(
      matchSiteName({ siteRegex: 'intranet', useSiteRegexOnly: true }, 'intranet.corp', siteKeys),
    ).toBe('intranet')
  })
})

describe('resolveEngineForSite', () => {
  it('returns the global selection when no override exists', () => {
    expect(resolveEngineForSite({ modelName: 'global-model', apiMode: null }, 'github')).toEqual({
      modelName: 'global-model',
      apiMode: null,
    })
  })

  it('returns the site override when set', () => {
    const config = {
      modelName: 'global-model',
      apiMode: null,
      siteEngineOverrides: {
        github: { modelName: 'claudeApi', apiMode: { groupName: 'claudeApiModelKeys' } },
      },
    }
    expect(resolveEngineForSite(config, 'github')).toEqual({
      modelName: 'claudeApi',
      apiMode: { groupName: 'claudeApiModelKeys' },
    })
    expect(resolveEngineForSite(config, 'google')).toEqual({
      modelName: 'global-model',
      apiMode: null,
    })
  })

  it('an empty override entry means follow the default', () => {
    const config = { modelName: 'm', apiMode: null, siteEngineOverrides: { github: {} } }
    expect(resolveEngineForSite(config, 'github')).toEqual({ modelName: 'm', apiMode: null })
  })

  it('null site name follows the default', () => {
    expect(resolveEngineForSite({ modelName: 'm', apiMode: null }, null)).toEqual({
      modelName: 'm',
      apiMode: null,
    })
  })
})
