// This is a local adapter selector, never a Google wire model ID.
export const GEMINI_WEB_MODEL = 'gemini-4-argon-high'
export const GEMINI_WEB_SELECTION = `geminiweb/${GEMINI_WEB_MODEL}`
export const GEMINI_WEB_MODEL_DESCRIPTION = '4 Argon'
// Observed from the native model service after choosing High in the real UI.
export const GEMINI_WEB_THINKING_LEVEL = 'THINKING_LEVEL_EXTENDED'
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

// Public code inspected on 2026-11-12. No account/token/response captures.
// An unknown runtime is refused rather than guessed or imported/executed.
export const GEMINI_NATIVE_CONTRACTS = Object.freeze([
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
