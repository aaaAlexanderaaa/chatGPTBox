import { describe, expect, it, vi } from 'vitest'
import {
  createCodeReference,
  extractNativeHashes,
  matchCodeReference,
  renameReferenceCode,
} from '../src/services/clients/gemini-web/code-equivalence.mjs'
import { resolveAutomaticGeminiContract } from '../src/services/clients/gemini-web/automatic-contract.mjs'

const version = 'boq-gemini-web-uiserver.BardChatUi.en.fixture.2018.O'
const nextVersion = 'boq-gemini-web-uiserver.BardChatUi.en.renamed.2018.O'
const units = [
  `"use strict";(function(_){var window=this;_.aa={};_.ba=function(a){};_.ca=function(a,b){return b};_.ViewsA=new Map();}).call(this,this.default_BardChatUi);`,
  `"use strict";(function(_){var window=this;var bridgeHelper;
  bridgeHelper=function(a,b){if(b.length>50000)throw Error("long");return a.Sv.sendRequest(b)};
  _.InputA=class{Sp(a){if(this.Bz())return;bridgeHelper(this,a)}Bz(){return this.Pr}};
  _.ServiceA=class{sendRequest(a){return _.PrepareA(this,a)}};
  _.PrepareA=function(a,b){return {question:b,model:a.mode}};
  _.AttestA=function(a,b){return a.attest(b)};
  _.ThinkA=function(a,b){if(a.available.includes(b))a.select(b)};
  _.HistoryA=class{constructor(){this.items=[]}};
  _.aa=_.HistoryA.prototype;_.aa.Ls=_.ba(1);_.aa.Rd=_.ba(2);
  _.aa.Ls=_.ca(1,function(a,b){return this.fetch({limit:b,cursor:a})});
  _.aa.Rd=_.ca(2,function(a,b){return this.fetch({conversation:a,limit:b})});
  }).call(this,this.default_BardChatUi);`,
]
const profile = {
  version,
  viewMap: 'ViewsA',
  inputClass: 'InputA',
  serviceClass: 'ServiceA',
  prepareFunction: 'PrepareA',
  attestationFunction: 'AttestA',
  thinkingSetter: 'ThinkA',
  fields: { service: 'Sv', submit: 'Sp', disabled: 'Bz', preparing: 'Pr' },
  history: { apiClass: 'HistoryA', serviceField: 'Hs', list: 'Ls', read: 'Rd', itemsField: 'It' },
  modelDescription: 'Synthetic model',
  thinkingLevel: 'synthetic-medium',
}
const keys = [
  ...Object.values(profile.fields),
  ...Object.entries(profile.history)
    .filter(([key]) => key !== 'apiClass')
    .map(([, value]) => value),
]
const reference = { referenceVersion: version, ...createCodeReference(units, keys) }

function renamed(sources = units) {
  return renameReferenceCode(sources, reference, (kind, index) => `changed${kind}_${index}`)
}
const inventory = (overrides = {}) => ({
  ok: true,
  nonce: 'document-proof',
  version: nextVersion,
  sourceUrls: ['base', 'app'].map(
    (name) => `https://gemini.gstatic.com/_/js/k=${nextVersion}/m=${name}`,
  ),
  ...overrides,
})
function resolverOptions(sources = renamed()) {
  const fetch = vi.fn(async (url) => new Response(sources[url.endsWith('base') ? 0 : 1]))
  return { references: [reference], contracts: [profile], fetch }
}

describe('complete Gemini compilation renaming equivalence', () => {
  it('separates namespace classes from same-spelled instance keys and data strings', () => {
    const source = [
      '(function(_){_.InputA=class{};_.AM=class{};_.Other=class{constructor(){this.InputA="AM"}}}).call(this,this.default_BardChatUi)',
    ]
    const ref = createCodeReference(source)
    const changed = renameReferenceCode(source, ref)
    const result = matchCodeReference(changed, ref)
    expect(result.names.namespace.get('InputA')).not.toBe('InputA')
    expect(result.names.namespace.get('AM')).not.toBe('AM')
    expect(changed[0]).toContain('this.InputA="AM"')
  })

  it('refuses unconfirmed namespace reflection, computed access or shadowing', () => {
    for (const body of ['use(_)', '_[key]', 'function hidden(_){return _.InputA}'])
      expect(() =>
        createCodeReference([
          `(function(_){_.InputA=class{};${body}}).call(this,this.default_BardChatUi)`,
        ]),
      ).toThrow(/namespace escape/)
  })

  it('refuses a consistent rename into JavaScript prototype-control keys', () => {
    const source = ['(function(_){_.Thing=class{}}).call(this,this.default_BardChatUi)']
    const ref = createCodeReference(source)
    for (const key of ['__proto__', 'prototype', 'constructor'])
      expect(matchCodeReference([source[0].replace('_.Thing', `_.${key}`)], ref)).toBeNull()
  })

  it('accepts a new build ID and a consistent renaming, with units in either inventory order', () => {
    expect(matchCodeReference(units, reference)).not.toBeNull()
    const match = matchCodeReference(renamed().reverse(), reference)
    expect(match.names.namespace.get('InputA')).not.toBe('InputA')
    expect(match.names.fields.get('Sp')).not.toBe('Sp')
    expect(match.names.helpers.get('bridgeHelper')).not.toBe('bridgeHelper')
  })

  it.each([
    ['condition', 'b.length>50000', 'b.length<50000'],
    ['constant', '50000', '50001'],
    ['literal', '"long"', '"different"'],
    ['external API', 'this.fetch(', 'this.send('],
    [
      'helper call count',
      'return a.Sv.sendRequest(b)',
      'a.Sv.sendRequest(b);return a.Sv.sendRequest(b)',
    ],
    ['binding/reference', 'bridgeHelper(this,a)', 'otherHelper(this,a)'],
    ['dynamic key', 'this.Pr', 'this["Pr"]'],
  ])('refuses a %s change anywhere in the complete code', (_, before, after) => {
    expect(matchCodeReference([units[0], units[1].replace(before, after)], reference)).toBeNull()
  })

  it('refuses helper changes even when all eight native root fingerprints are unchanged', async () => {
    const changed = [units[0], units[1].replace('50000', '50001')]
    expect(await extractNativeHashes(changed, profile)).toEqual(
      await extractNativeHashes(units, profile),
    )
    expect(matchCodeReference(changed, reference)).toBeNull()
  })

  it('refuses a return/newline ASI change despite identical lexical tokens', () => {
    const changed = [
      units[0],
      units[1].replace('return a.Sv.sendRequest(b)', 'return\n a.Sv.sendRequest(b)'),
    ]
    expect(matchCodeReference(changed, reference)).toBeNull()
  })

  it('preserves raw strict directives instead of comparing only decoded strings', () => {
    const changed = [units[0].replace('"use strict"', '"use\\x20strict"'), units[1]]
    expect(matchCodeReference(changed, reference)).toBeNull()
  })

  it('accepts ordinary whitespace/comments with unchanged parser decisions', () => {
    expect(
      matchCodeReference(
        units.map((source) => source.replaceAll(';', '; /* unchanged */\n')),
        reference,
      ),
    ).not.toBeNull()
  })

  it('refuses inconsistent renames and collisions with fixed local/global/API identifiers', () => {
    const changed = renamed()
    const method = matchCodeReference(changed, reference).names.fields.get('Sp')
    expect(
      matchCodeReference([changed[0], changed[1].replace(method, 'fetch')], reference),
    ).toBeNull()
    const helper = matchCodeReference(changed, reference).names.helpers.get('bridgeHelper')
    expect(
      matchCodeReference([changed[0], changed[1].replace(helper, 'window')], reference),
    ).toBeNull()
  })

  it('requires every unit and refuses extra or ambiguous units', () => {
    expect(matchCodeReference(units.slice(1), reference)).toBeNull()
    expect(matchCodeReference([...units, units[0]], reference)).toBeNull()
    expect(matchCodeReference([units[0], units[0]], reference)).toBeNull()
  })

  it('keeps strings/dynamic field names fixed instead of guessing their meaning', () => {
    const source = [
      '(function(_){_.Thing=class{Sp(){return this["Sp"]}}})(this.default_BardChatUi)',
    ]
    const ref = createCodeReference(source, ['Sp'])
    expect(ref.symbols[2]).not.toContain('Sp')
    expect(matchCodeReference([source[0].replace('Sp()', 'Changed()')], ref)).toBeNull()
  })

  it('does not rename an unbound global just because a wrapper-local helper shares its spelling', () => {
    const source = [
      'outsideHelper();(function(_){var outsideHelper=function(){};_.Thing=function(){return outsideHelper()}}).call(this,this.default_BardChatUi)',
    ]
    const ref = createCodeReference(source)
    expect(ref.symbols[3]).not.toContain('outsideHelper')
    expect(
      matchCodeReference([source[0].replaceAll('outsideHelper', 'renamedHelper')], ref),
    ).toBeNull()
  })

  it('does not promote block-local let/const bindings into wrapper-wide helper names', () => {
    const source = [
      '(function(_){if(flag){let scopedHelper=function(){}}scopedHelper();_.Thing=function(){return 1}}).call(this,this.default_BardChatUi)',
    ]
    const ref = createCodeReference(source)
    expect(ref.symbols[3]).not.toContain('scopedHelper')
    expect(
      matchCodeReference([source[0].replaceAll('scopedHelper', 'otherHelper')], ref),
    ).toBeNull()
  })

  it('does not create references for dynamic code or exceed resource limits', () => {
    expect(() => createCodeReference(['eval("send()")'])).toThrow(/Dynamic/)
    expect(matchCodeReference([' '.repeat(8 * 1024 * 1024 + 1)], reference)).toBeNull()
  })
})

describe('automatic Gemini contract resolution', () => {
  it('derives the renamed profile and exact new native fingerprints without executing website code', async () => {
    const options = resolverOptions()
    const resolved = await resolveAutomaticGeminiContract(inventory(), options)
    expect(resolved?.version).toBe(nextVersion)
    expect(resolved.inputClass).not.toBe(profile.inputClass)
    expect(resolved.fields.submit).not.toBe(profile.fields.submit)
    expect(resolved.hashes).toEqual(await extractNativeHashes(renamed(), resolved))
    expect(Object.keys(resolved.hashes)).toHaveLength(8)
    expect(resolved.automaticProof.nonce).toBe('document-proof')
    for (const [, init] of options.fetch.mock.calls)
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' })
  })

  it('refuses changed code, missing definitions and competing matching references', async () => {
    expect(
      await resolveAutomaticGeminiContract(
        inventory(),
        resolverOptions([units[0], units[1].replace('50000', '50001')]),
      ),
    ).toBeNull()
    const options = resolverOptions()
    options.references = [reference, reference]
    expect(await resolveAutomaticGeminiContract(inventory(), options)).toBeNull()
  })

  it.each([
    ['foreign host', ['https://example.com/_/js/k=x/m=app']],
    [
      'credential-bearing URL',
      [`https://user:pass@gemini.gstatic.com/_/js/k=${nextVersion}/m=app`],
    ],
    ['query', [`https://gemini.gstatic.com/_/js/k=${nextVersion}/m=app?token=private`]],
    ['other build', [`https://gemini.gstatic.com/_/js/k=${version}/m=app`]],
  ])('refuses %s before fetching public code', async (_, sourceUrls) => {
    const options = resolverOptions()
    expect(
      await resolveAutomaticGeminiContract(
        inventory({ sourceUrls: [...sourceUrls, inventory().sourceUrls[0]] }),
        options,
      ),
    ).toBeNull()
    expect(options.fetch).not.toHaveBeenCalled()
  })

  it('refuses failed, truncated or excessive public code reads', async () => {
    const options = resolverOptions()
    options.fetch = vi.fn(async () => new Response('', { status: 503 }))
    expect(await resolveAutomaticGeminiContract(inventory(), options)).toBeNull()
    options.fetch = vi.fn(
      async () => new Response('', { headers: { 'content-length': String(9 * 1024 * 1024) } }),
    )
    expect(await resolveAutomaticGeminiContract(inventory(), options)).toBeNull()
  })
})
