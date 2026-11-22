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

  it('refuses implicit namespace this aliases, including adapter-only entrypoints and function aliases', () => {
    const prefix = '(function(_){_.AM=class{};'
    const suffix = '}).call(this,this.default_BardChatUi)'
    for (const body of [
      '_.read=function(){return this.AM};_.read()',
      'var readAlias=function(){return this.AM};_.read=readAlias;_.read()',
      '_.read=_.ca(91,function(){return this.AM});_.read()',
      '_.read=_.da(91,function(){return this.AM});_.read()',
      '_.factory=function(){return function(){return this.AM}};_.read=_.factory();_.read()',
    ])
      expect(() => createCodeReference([prefix + body + suffix])).toThrow(/namespace this/)
    expect(() =>
      createCodeReference([prefix + '_.read=function(){return this.AM};' + suffix], [], ['read']),
    ).toThrow(/namespace this/)
  })

  it('refuses unresolved namespace function targets instead of certifying an incomplete receiver audit', () => {
    expect(() =>
      createCodeReference(['(function(_){_.missing()}).call(this,this.default_BardChatUi)']),
    ).toThrow(/Unconfirmed namespace call/)
  })

  it('allows a proved receiver-ignoring callback forwarder but refuses receiver readers or mutable delegates', () => {
    const factory =
      '_.memo=function(a){var b=false,c;return function(){if(!b){c=a.apply(this,arguments);b=true}return c}};'
    const wrap = (body) => `(function(_){_.AM=class{};${body}}).call(this,this.default_BardChatUi)`
    expect(() =>
      createCodeReference([wrap(factory + '_.read=_.memo(function(){return 1});_.read()')]),
    ).not.toThrow()
    expect(() =>
      createCodeReference([wrap(factory + '_.read=_.memo(function(){return this.AM});_.read()')]),
    ).toThrow(/namespace this/)
    expect(() =>
      createCodeReference([
        wrap(
          factory.replace('var b=false,c;', 'a=function(){return this.AM};var b=false,c;') +
            '_.read=_.memo(function(){return 1});_.read()',
        ),
      ]),
    ).toThrow(/namespace this/)
  })

  it('does not treat an arbitrary bind-named method as the intrinsic Function bind', () => {
    const source = [
      '(function(_){_.AM=class{};_.object={bind(){return function(){return this.AM}}};_.read=_.object.bind(null);_.read()}).call(this,this.default_BardChatUi)',
    ]
    expect(() => createCodeReference(source)).toThrow(/Unconfirmed namespace/)
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
  it('preserves deferred-code restrictions in the derived namespace', async () => {
    const options = resolverOptions()
    options.references = [
      {
        ...reference,
        receiverContract: {
          ...reference.receiverContract,
          unavailableExports: ['InputA', 'DeferredExport'],
          requiresNoWizbind: true,
        },
      },
    ]
    const resolved = await resolveAutomaticGeminiContract(inventory(), options)
    expect(resolved.automaticProof).toMatchObject({
      unavailableExports: [resolved.inputClass, 'DeferredExport'],
      requiresNoWizbind: true,
    })
    expect(resolved.inputClass).not.toBe('InputA')
  })

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

  it('accepts a shifted _.ca stub and _.da module installer pair', async () => {
    const shifted = [
      units[0]
        .replace('_.ba=function(a){};', '')
        .replace('_.ca=function(a,b){return b}', '_.ca=function(a){};_.da=function(a,b){return b}'),
      units[1].replaceAll('_.ca(', '_.da(').replaceAll('_.ba(', '_.ca('),
    ]
    const shiftedRef = { referenceVersion: version, ...createCodeReference(shifted, keys) }
    const renamedShifted = renameReferenceCode(
      shifted,
      shiftedRef,
      (kind, index) => `alt${kind}_${index}`,
    )
    const mssUrls = ['_b', 'vLefie'].map(
      (name) =>
        `https://gemini.gstatic.com/_/mss/boq-gemini-web-uiserver/_/js/k=${nextVersion}/m=${name}?wli=BardChatUi.l5EF44GVmg0.mediaIntentWasm.O%3A%3B`,
    )
    const resolved = await resolveAutomaticGeminiContract(inventory({ sourceUrls: mssUrls }), {
      references: [shiftedRef],
      contracts: [profile],
      fetch: vi.fn(async (url) => new Response(renamedShifted[url.includes('/m=_b?') ? 0 : 1])),
    })
    expect(resolved?.version).toBe(nextVersion)
    expect(resolved.hashes).toEqual(await extractNativeHashes(renamedShifted, resolved))
    expect(resolved.automaticProof.sourceUrls).toEqual([...mssUrls].sort())
  })

  it.each([
    ['foreign host', ['https://example.com/_/js/k=x/m=app']],
    ['unknown mss app', [`https://gemini.gstatic.com/_/mss/other/_/js/k=${nextVersion}/m=app`]],
    [
      'path traversal',
      [`https://gemini.gstatic.com/_/mss/boq-gemini-web-uiserver/_/js/../x/k=${nextVersion}/m=app`],
    ],
    [
      'encoded path traversal',
      [
        `https://gemini.gstatic.com/_/mss/boq-gemini-web-uiserver/_/js/%2e%2e/k=${nextVersion}/m=app`,
      ],
    ],
    [
      'credential-bearing URL',
      [`https://user:pass@gemini.gstatic.com/_/js/k=${nextVersion}/m=app`],
    ],
    ['query', [`https://gemini.gstatic.com/_/js/k=${nextVersion}/m=app?token=private`]],
    [
      'non-BardChatUi wli query',
      [
        `https://gemini.gstatic.com/_/mss/boq-gemini-web-uiserver/_/js/k=${nextVersion}/m=app?wli=OtherUi.foo`,
      ],
    ],
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

  it('derives a verified structural-core contract on signed-in multi-chunk inventories and refuses core tampering', async () => {
    const structuralVersion = 'boq-gemini-web-uiserver.BardChatUi.en.syntheticStruct.2018.O'
    const coreUrls = [
      `https://gemini.gstatic.com/_/mss/boq-gemini-web-uiserver/_/js/k=${structuralVersion}/d=1/excm=_b/m=_b?wli=BardChatUi.abc.mediaIntentWasm.O%3A%3B`,
      `https://gemini.gstatic.com/_/mss/boq-gemini-web-uiserver/_/js/k=${structuralVersion}/d=1/exm=_b/excm=_b/m=vLefie?wli=BardChatUi.abc.mediaIntentWasm.O%3A%3B`,
    ]
    const runtimeSrc = `(function(_){_.aa={};_.ca=function(a){return a};_.da=function(a,b){return b};}).call(this,this.default_BardChatUi);`
    const appSrc = `(function(_){
      var bindView=function(b){_.vMap.set(b[19],b)};
      var sendChain=function(a,b,c,d){return a.Ta.sendRequest({textQuery:a.Ml.value})};
      _.svcTok=new _.Mv("ConversationService",{tb:"root",hb:()=>{_.u(_.x);return _.fe(_.ee("CVUPx"),!1)?_.u(_.fakeSvc):_.u(_.RealSvc)}});
      _.apiTok=_.xC("ConversationApi",_.RealApi,_.fakeApi);
      _.RealApi=class{
        constructor(){this.Aa=_.u(_.x);this.Ba={z:1};this.requestSource=1}
        Lst(a,b,c){var d=Ble(Ale(new _.Yxc,\na.pinned),a.exF);a.conversationId&&_.lg(d,6,a.conversationId);return _.gt(()=>this.Aa.fetch(bme.getInstance(d))).pipe(_.r(f=>({itF:_.Af(f,_.Vy,3,void 0).map(_.lle),nextPageToken:_.m(f,2)})))}
      };
      _.aa=_.RealApi.prototype;
      _.aa.RdM=_.ca(780);
      _.aa.AtM=_.ca(777);
      var readConv=function(a,b){return Object.assign({},{rwF:f,nextPageToken:_.m(a,2)})};
      _.aa.RdM=_.da(780,function(a,b,c,d){var e=this.requestSource;return _.gt(()=>this.Aa.fetch(wHe.getInstance(e))).pipe(_.r(f=>{f=readConv(f,a,this.Ba.x);return f}))});
      _.aa.AtM=_.da(777,function(a){return _.AttFn(this.mb,a)});
      _.AttFn=function(a,b){return a.Ba.pipe(_.r(d=>({request:b,botguardResponse:d.botguardResponse,botguardSalt:d.botguardSalt})))};
      _.ThinkFn=function(a,b,c){a.Teb(b)&&a.Rb.pipe(_.tt(1)).subscribe(d=>{d.length!==0&&(d=a.Zed(d,b,c))&&_.uie(a,b,d.routingVariantId)})};
      _.PrepFn=function(a,b,c){return _.Ws({oa:a.bardModeService.oa,Ca:a.bardModeService.Ca}).pipe(_.r(({oa:je,Ca:jj})=>{var yk={clientTurnId:b.clientTurnId,conversationId:"",textQuery:b.textQuery,reqPar:Ze||"",parentResponseId:"",reqMode:je==null?void 0:je.id,thinkingLevel:jj};return{request:yk}}))};
      _.RealSvc=class{
        constructor(){this.Po=_.u(_.apiTok);this.Pb=_.u(_.mF);this.Ve=this.store.select(_.sel);this.hasRows=this.Ve.pipe(_.r(h=>!!fn(h.rwF)))}
        sendRequest(a,b){var c=Object.assign({},a,{clientTurnId:a.clientTurnId});var d=void 0;this.Pb.pipe(_.yF(_.Xme),_.mt(x=>x));this.store.dispatch(c);return _.PrepFn(this,c,d)}
      };
      _.SendAct=_.UB(rK("Send Request"),_.VB());
      _.FailAct=_.UB(rK("Generate Response Failure"),_.VB());
      var emitActs=function(a,b,c,v){(0,_.SendAct)({request:c,dispF:{Nd:b,request:c}});(0,_.FailAct)({failF:Object.assign({},{error:a}),metaF:v})};
      var renderMath=function(a){return{nodeType:12,mathF:_.m(a,1)}};
      var renderDef=function(a){return{nodeType:6,entries:a.map(c=>Object.assign({},(d==null?void 0:d.nodeType)===18&&{defF:d}))}};
      _.RealInp=class{
        constructor(){
          this.Ta=_.u(_.svcTok);
          this.Ml=new _.YO("",{yk:!0});this.z=this.Ml.wl.pipe(_.r(x=>x));
          this.qd=_.ie(_.he("Lz8rbb"),!1);
          this.Lb=this.Kla.oa;
          this.Ke=_.Y(()=>0);
          this.BWe=_.Y(()=>({featureMode:this.Ke()}));
          this.B6=_.Q(!1);
          this.DQ=this.Ca.Aa?_.Z(this.Ca.Ca.pipe(_.Wv(S=>S.Ia)),{initialValue:!1}):_.Q(!1).asReadonly();
          this.Gv=_.Y(()=>this.Toe()||this.Bxf()||this.B6());
          this.ufa=_.Y(()=>!1);
          this.lbl=_.Y(()=>this.ufa()?"Stop response":this.B6()?"Cancel send":"Send message");
          this.KIc=_.Y(()=>this.To().some(S=>!(S==null?0:S.Wi)));
          this.Aue=_.Y(()=>this.XNc()||this.ifa().size>0||this.lDa());
        }
        SubM(a,b,c,d){if(a)return;else if(!this.DQ())if(this.B6())return;else{var x=this.Ml.value;if(this.Ga.Ha(_.op)&&!this.Lb&&a&&this.Df()){}sendChain(this,b,c,d)}}
      };
      _.RealInp.Xa=_.Bw({type:_.RealInp,Sa:[["input-area-v2"]],inputs:{Toe:[1,"disableInput"]}});
    }).call(this,this.default_BardChatUi);`

    const resolved = await resolveAutomaticGeminiContract(
      {
        ok: true,
        nonce: 'core-nonce',
        version: structuralVersion,
        sourceUrls: coreUrls,
        scope: 'core',
      },
      {
        references: [],
        contracts: [{ modelDescription: '4 Neon', thinkingLevel: 'THINKING_LEVEL_EXTENDED' }],
        fetch: vi.fn(async (url) => new Response(url.includes('/m=_b?') ? runtimeSrc : appSrc)),
      },
    )
    expect(resolved).toMatchObject({
      version: structuralVersion,
      viewMap: 'vMap',
      inputClass: 'RealInp',
      serviceClass: 'RealSvc',
      prepareFunction: 'PrepFn',
      attestationFunction: 'AttFn',
      thinkingSetter: 'ThinkFn',
      history: {
        apiClass: 'RealApi',
        serviceField: 'Po',
        list: 'Lst',
        read: 'RdM',
        itemsField: 'itF',
        exactFilter: 'exF',
        rowsField: 'rwF',
      },
      fields: {
        service: 'Ta',
        submit: 'SubM',
        form: 'Ml',
        eligible: 'qd',
        generating: 'ufa',
        preparing: 'B6',
        disabled: 'Gv',
        editing: 'DQ',
        attachments: 'KIc',
        references: 'Aue',
        embedded: 'Lb',
        feature: 'Ke',
        state: 'Ve',
        actions: 'Pb',
        rows: 'rwF',
        metadata: 'metaF',
        dispatch: 'dispF',
        failure: 'failF',
        requestMode: 'reqMode',
        requestParent: 'reqPar',
        math: 'mathF',
        definitionTerm: 'defF',
      },
      automaticProof: {
        mode: 'structural-core',
        nonce: 'core-nonce',
        version: structuralVersion,
        sourceUrls: [...coreUrls].sort(),
      },
    })
    expect(resolved.hashes).toEqual(await extractNativeHashes([runtimeSrc, appSrc], resolved))

    for (const mutated of [
      appSrc.replaceAll('botguardResponse', 'removedGuard'),
      appSrc.replace('sendChain(this,b,c,d)', 'fetch("/x");sendChain(this,b,c,d)'),
      appSrc.replace('return{request:yk}', 'eval("x");return{request:yk}'),
      appSrc.replace('a.Ta.sendRequest', 'a.Ta.otherCall'),
      appSrc.replace('thinkingLevel:jj', 'otherLevel:jj'),
    ]) {
      expect(
        await resolveAutomaticGeminiContract(
          {
            ok: true,
            nonce: 'core-nonce',
            version: structuralVersion,
            sourceUrls: coreUrls,
            scope: 'core',
          },
          {
            references: [],
            contracts: [{ modelDescription: '4 Neon', thinkingLevel: 'THINKING_LEVEL_EXTENDED' }],
            fetch: vi.fn(
              async (url) => new Response(url.includes('/m=_b?') ? runtimeSrc : mutated),
            ),
          },
        ),
      ).toBeNull()
    }
  })
})
