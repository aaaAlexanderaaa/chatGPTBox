import { describe, expect, it } from 'vitest'
import { WEB_ENGINE_DEFINITIONS } from '../src/engines/catalog.mjs'
import {
  assertEngineAdmission,
  assertRunAccess,
  migrateEngineExposure,
} from '../src/engines/policy.mjs'
import { EngineOperation as Op } from '../src/engines/contract.mjs'

describe('engine external policy', () => {
  it('does not turn private management methods into API capabilities through an edited grant', () => {
    const operation = 'chatgptweb.conversation.delete'
    const config = {
      chatgptWebEnabled: true,
      engineExposure: { chatgptweb: { externalEnabled: true, operations: [operation] } },
    }
    expect(() =>
      assertEngineAdmission(config, WEB_ENGINE_DEFINITIONS[0], operation, {
        kind: 'api',
        principal: 'gateway-api',
      }),
    ).toThrow(/internal/)
    expect(() =>
      assertEngineAdmission(config, WEB_ENGINE_DEFINITIONS[0], operation, {
        kind: 'extension',
        principal: 'settings',
      }),
    ).not.toThrow()
  })
  it('uses the same external operation grants for API and MCP', () => {
    const config = {
      apiServerEnabled: true,
      chatgptWebEnabled: true,
      grokWebEnabled: true,
      geminiWebEnabled: true,
    }
    Object.assign(config, migrateEngineExposure(config))
    expect(config.engineExposure.grokweb).toMatchObject({
      externalEnabled: true,
    })
    expect(config.engineExposure.chatgptweb).not.toHaveProperty('mcpEnabled')
    expect(config.engineExposure.geminiweb.operations).toEqual([Op.Generate])
    expect(() =>
      assertEngineAdmission(config, WEB_ENGINE_DEFINITIONS[1], Op.Generate, {
        kind: 'mcp',
        principal: 'gateway-api',
      }),
    ).not.toThrow()
    expect(() =>
      assertEngineAdmission(config, WEB_ENGINE_DEFINITIONS[1], Op.Generate, {
        kind: 'api',
        principal: 'gateway-api',
      }),
    ).not.toThrow()
  })

  it('does not recreate a grant after a user disables it or a model check changes', () => {
    const config = {
      apiServerEnabled: true,
      grokWebEnabled: true,
      ...migrateEngineExposure({ apiServerEnabled: false }),
    }
    config.engineExposure.grokweb.externalEnabled = false
    expect(migrateEngineExposure(config).engineExposure.grokweb.externalEnabled).toBe(false)
  })

  it('fails closed for malformed current grants and disabled engines', () => {
    const config = {
      engineExposureVersion: 1,
      engineExposure: { grokweb: { externalEnabled: 'true', operations: [Op.Generate] } },
      grokWebEnabled: true,
    }
    expect(() =>
      assertEngineAdmission(config, WEB_ENGINE_DEFINITIONS[1], Op.Generate, {
        kind: 'api',
        principal: 'gateway-api',
      }),
    ).toThrow(/disabled/)
    Object.assign(config, migrateEngineExposure({ apiServerEnabled: true, grokWebEnabled: true }))
    config.grokWebEnabled = false
    expect(() =>
      assertEngineAdmission(config, WEB_ENGINE_DEFINITIONS[1], Op.Generate, {
        kind: 'api',
        principal: 'gateway-api',
      }),
    ).toThrow(/Grok Web is disabled/)
  })

  it('does not accept a body-provided surface as an authenticated caller', () => {
    const config = { apiServerEnabled: true, ...migrateEngineExposure({ apiServerEnabled: true }) }
    expect(() =>
      assertEngineAdmission(config, WEB_ENGINE_DEFINITIONS[0], Op.Generate, {
        surface: 'extension',
      }),
    ).toThrow(/authenticated/)
    expect(() =>
      assertRunAccess({ principal: 'gateway-api' }, { kind: 'extension', principal: 'content:1' }),
    ).toThrow(/different/)
    expect(() =>
      assertRunAccess({ principal: 'gateway-api' }, { kind: 'mcp', principal: 'gateway-api' }),
    ).not.toThrow()
  })
})
