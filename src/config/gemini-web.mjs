// This is a local adapter selector, never a Google wire model ID.
export const GEMINI_WEB_MODEL = 'gemini-4-hydrogen-medium'
export const GEMINI_WEB_SELECTION = `geminiweb/${GEMINI_WEB_MODEL}`
export const GEMINI_WEB_MODEL_DESCRIPTION = '4 Hydrogen'
// Observed from the native model service after choosing Medium in the real UI.
export const GEMINI_WEB_THINKING_LEVEL = 'THINKING_LEVEL_MEDIUM'
export const GEMINI_WEB_MAX_TABS = 3
export const GEMINI_WEB_TIMEOUT_MS = 45 * 60 * 1000

export function isGeminiWebModel(model) {
  return (
    typeof model === 'string' && (model.startsWith('gemini-') || model.startsWith('geminiweb/'))
  )
}

export function geminiWebConversationUrl(session) {
  try {
    const url = new URL(session?.geminiWebUrl)
    if (
      url.origin === 'https://gemini.google.com' &&
      /^\/app(?:\/[a-zA-Z0-9_-]+)?\/?$/.test(url.pathname)
    )
      return url.origin + url.pathname
  } catch {
    /* use the normal site entry */
  }
  return 'https://gemini.google.com/app'
}

// Public code inspected on 2026-11-12/13. No account/token/response captures.
// An unknown runtime is refused rather than guessed or imported/executed.
export const GEMINI_NATIVE_CONTRACTS = Object.freeze([
  {
    version: 'boq-gemini-web-uiserver.BardChatUi.en.K_sMMmyCg9A.2018.O',
    viewMap: 'NYb',
    inputClass: 'X6',
    serviceClass: 'BM',
    prepareFunction: 'QGe',
    attestationFunction: 'wAe',
    thinkingSetter: 'Qae',
    dictationIndicator: 'native-button-label',
    history: {
      apiClass: 'rK',
      serviceField: 'Ko',
      list: 'tia',
      read: 'kDa',
      itemsField: 'Fl',
      exactFilter: 'yV',
      rowsField: 'Qb',
    },
    fields: {
      service: 'Ta',
      submit: 'WPa',
      form: 'Dl',
      eligible: 'vd',
      generating: 'Hea',
      preparing: 'C9',
      disabled: 'xv',
      editing: 'jE',
      attachments: 'Wh',
      references: 'WUb',
      embedded: 'Nb',
      feature: 'Ge',
      state: 'Ve',
      actions: 'Ob',
      rows: 'Qb',
      metadata: 'Gm',
      dispatch: 'gC',
      failure: 'YAa',
      requestMode: 'Si',
      requestParent: 'Yj',
      math: 'qOa',
      definitionTerm: 'Lw',
    },
    hashes: {
      submit: 'be25ea1aa62f4dcf0d61cd24e461d3170dd002c33f1ba207ffd02685831f73ba',
      send: 'd6ef9e8e251a4283d647be2b5044675d79682d596fb20c4802e3bdfbb67e8c63',
      prepare: '18beef5ef0128310b7b53f82f57cb85739f4fa5c04b8a82da6baab2a238fdd70',
      attestation: '34f91148a398dc9a1d238fe3e68ec635962df14c33d06c8c75da0f73115bc524',
      thinking: 'dc39a8bc7554f4398731b0b0ed8fc9fe04d0ce7b68bccc221f7dcd0e698c3876',
      historyClass: '5376ed1dca856bea9540133f4bea970575e41bede010ee95333124b400ca933b',
      list: '3cc8cdcb411a68506b0a7a21473524dc62eabe64769808fd39b966940f14dc84',
      read: '102b07451b7ff3bdd3f48ef1339768631f4c03e46c0542118d9eb6992ed7323a',
    },
    modelDescription: GEMINI_WEB_MODEL_DESCRIPTION,
    thinkingLevel: GEMINI_WEB_THINKING_LEVEL,
  },
  {
    version: 'boq-gemini-web-uiserver.BardChatUi.en.TX_RV411Rb4.2018.O',
    viewMap: 'GYb',
    inputClass: 'X6',
    serviceClass: 'AM',
    prepareFunction: 'HGe',
    attestationFunction: 'oAe',
    thinkingSetter: 'Jae',
    dictationIndicator: 'native-button-label',
    history: {
      apiClass: 'rK',
      serviceField: 'Mo',
      list: 'oia',
      read: 'gDa',
      itemsField: 'Fl',
      exactFilter: 'yV',
    },
    fields: {
      service: 'Ta',
      submit: 'TPa',
      form: 'Dl',
      eligible: 'ud',
      generating: 'Cea',
      preparing: 'w9',
      disabled: 'wv',
      editing: 'iE',
      attachments: 'Sh',
      references: 'QUb',
      embedded: 'Mb',
      feature: 'Ie',
      state: 'Ve',
      actions: 'Ob',
      rows: 'Pb',
      metadata: 'Gm',
      dispatch: 'eC',
      failure: 'SAa',
      requestMode: 'Ti',
      requestParent: 'Yj',
      math: 'oOa',
      definitionTerm: 'Mw',
    },
    hashes: {
      submit: '61c4991f2e72174d62ab0c6f10de272aa0f0e64c693f7d1121db1bd3ea4a1282',
      send: 'f2bfa128813371126aab72807827dc676f41f3b3ee8e1375bf89501d20f3b163',
      prepare: '24f1cc0636f39922a65916332e338cbae3e285547e70099f5d7f01e25020f7d6',
      attestation: '0c77450553f6bb14532bbd543f365bb440ab6c6dbb14153038f858f5acd9666c',
      thinking: '98980b4b10111937c0f2b8293b1c8bac2f99ac2a8bfd2377a29de1274bc2acff',
      historyClass: '94f5dfd81e8f73dd76d58f34675e3d14ddf0c7e208f9f86292f3bba134cecc95',
      list: 'b48d37fbd8bb935718dc93882fe4fc2736e3db54a3f1ceb229c69c8a72b0088f',
      read: 'c8990bad27a0459563808ba40d60734a7cbb4a3d47f9689aa47af6b8daad1cbb',
    },
    modelDescription: GEMINI_WEB_MODEL_DESCRIPTION,
    thinkingLevel: GEMINI_WEB_THINKING_LEVEL,
  },
  {
    version: 'boq-gemini-web-uiserver.BardChatUi.en.7qWXQUpytUc.2018.O',
    viewMap: 'mYb',
    inputClass: 'R6',
    serviceClass: 'sM',
    prepareFunction: 'WFe',
    attestationFunction: 'Gze',
    thinkingSetter: 'fae',
    dictationIndicator: 'native-button-label',
    history: { apiClass: 'lK', serviceField: 'Io', list: 'vha', read: 'lCa' },
    fields: {
      service: 'Ta',
      submit: 'VOa',
      form: 'Nl',
      eligible: 'ud',
      generating: 'Oda',
      preparing: 'T8',
      disabled: 'rv',
      editing: 'YD',
      attachments: 'Nh',
      references: 'BTb',
      embedded: 'Ob',
      feature: 'Oe',
      state: 'Xe',
      actions: 'Nb',
      rows: 'Pb',
      metadata: 'Gm',
      dispatch: 'UB',
      failure: 'aAa',
      requestMode: 'xj',
      requestParent: 'Yj',
      math: 'sNa',
      definitionTerm: 'Hw',
    },
    hashes: {
      submit: '8b8f85abb9f5848adce30feafb3ff4444778e2b6f8845934a7864d582206afdc',
      send: '1952697e8bd5c759f315996055b3daf8302af477834f2daf9e39d31584002f72',
      prepare: '4171a65a20a9d62fab6d24e4da0f3d813c557137c25f0bd2581795ee9b6121a4',
      attestation: '41d9d54fa8ba0a109aecfc3dbd53794fcdec0dd1dac53d43d61a77c0cd02be3f',
      thinking: '02ef93e695148883f1397dd1cde9a797c192a38d3098a9b1eb62083272ae668d',
      historyClass: '561527d3a7904b033084c506e3bcdca6d5193336f6aa19cbe6ba56042c68d969',
      list: '815aed6f79eae31fbd37f3d7bb1c0de7ceac5fe11288e7df5c3ef7b7f3f67f64',
      read: '061347d033e7af55e897468e0380e2cdf34ae7ebf30e540ffd865f79df77ab37',
    },
    modelDescription: GEMINI_WEB_MODEL_DESCRIPTION,
    thinkingLevel: GEMINI_WEB_THINKING_LEVEL,
  },
  {
    version: 'boq-gemini-web-uiserver.BardChatUi.en.VxAhX7iBM_A.2018.O',
    viewMap: 'uXb',
    inputClass: 'y6',
    serviceClass: 'mM',
    hashes: {
      submit: 'c7597854e92a66f21e7822244f1ea8a40bd0de3075067e2636ebaab350a20942',
      send: '344d06d6823629a3c0e8c285dd4717ef744333d74d626248919c5b8ccf007886',
      prepare: 'a36365a6217556162c5aceba047cacccc31e917dbc7cfd7d28e4e24ecaaee39e',
      attestation: 'ebef7a380572ad7285a9f6d09727a5b83f82dac4ba40faf60a44084c4366bb22',
    },
    modelDescription: GEMINI_WEB_MODEL_DESCRIPTION,
    thinkingLevel: GEMINI_WEB_THINKING_LEVEL,
  },
  {
    version: 'boq-gemini-web-uiserver.BardChatUi.en.qGl2D_iBXPk.2018.O',
    viewMap: 'dYb',
    inputClass: 'B6',
    serviceClass: 'nM',
    prepareFunction: 'GEe',
    attestationFunction: 'bde',
    thinkingSetter: 'T9d',
    fields: {
      service: 'Sa',
      submit: 'JNa',
      form: 'Jl',
      eligible: 'od',
      generating: 'dda',
      preparing: 'm8',
      dictating: 'JD',
      disabled: 'V1',
      editing: 'ov',
      attachments: 'nNc',
      references: 'MRb',
      embedded: 'Ob',
      feature: 'Ke',
      state: 'Ye',
      actions: 'Nb',
      rows: 'Pb',
      metadata: 'Cm',
      dispatch: 'KB',
      failure: 'cza',
      requestMode: 'qj',
      math: 'aYa',
      definitionTerm: 'yw',
    },
    hashes: {
      submit: 'de8aa71f23e0bee686caddb4047ef9b145b13929bdad1bc67cbb30b129645fe2',
      send: '707b4e92102a4c74b9f123e39563523aa0b1f7b5b1e7fd6e674414872f4584a4',
      prepare: 'f28a670851f4f5540a0d47e95abd1824590de0a3f7fe6fa397d1de5a47f1980d',
      attestation: '1a252874ab8d83b98de9ca71152c2e32a1e00ea95dae9e5367577a60aba49ecf',
      thinking: '2cbe76fbfdab322e0b11b1d36f57e87c66165b48230bd27576028a9d13971039',
    },
    modelDescription: GEMINI_WEB_MODEL_DESCRIPTION,
    thinkingLevel: GEMINI_WEB_THINKING_LEVEL,
  },
])
