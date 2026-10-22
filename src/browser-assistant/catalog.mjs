import { FUNCTION_PRESETS, createFunction, validateFunction } from './functions.mjs'

// Entries consume this catalog. Their names are open strings so adding another
// entry does not require another kind of function or a new configuration store.
export const FUNCTION_ENTRIES = [
  { id: 'function-picker', label: 'Function picker' },
  { id: 'context-menu', label: 'Context menu' },
  { id: 'selection-toolbar', label: 'Selection toolbar' },
]
export const DEFAULT_ENTRIES = FUNCTION_ENTRIES.map((entry) => entry.id)

const selectionDefinitions = [
  [
    'explain',
    'Explain selection',
    'Explain this passage clearly, including the context needed to understand it.',
  ],
  [
    'translate',
    'Translate',
    'Translate the following text into {{language}}, preserving meaning, tone, and formatting. Return only the translation.',
  ],
  [
    'translateToEn',
    'Translate (To English)',
    'Translate the following text into English, preserving meaning, tone, and formatting. Return only the translation.',
  ],
  [
    'translateToZh',
    'Translate (To Chinese)',
    'Translate the following text into Chinese, preserving meaning, tone, and formatting. Return only the translation.',
  ],
  [
    'translateBidi',
    'Translate (Bidirectional)',
    'Translate the following text into {{language}}. If it is already in {{language}}, translate it into English. Preserve meaning, tone, and formatting. Return only the translation.',
  ],
  [
    'summary',
    'Summary',
    'Summarize the main ideas and supporting evidence. Point out what is uncertain.',
  ],
  [
    'polish',
    'Polish',
    'Improve clarity and flow while preserving the meaning and language. Return only the revised text, with no introduction or code fences.',
  ],
  [
    'sentiment',
    'Sentiment Analysis',
    'Analyze the emotional tone of this passage and explain the main signals.',
  ],
  [
    'divide',
    'Divide Paragraphs',
    'Divide this text into clear, readable paragraphs without changing its meaning or language.',
  ],
  [
    'code',
    'Code Explain',
    'Explain this code step by step, including its purpose, design choices, and potential issues.',
  ],
  [
    'ask',
    'Ask',
    'Analyze this passage and give a concise answer or opinion with a short explanation.',
  ],
]

export function localizeFunction(item, t) {
  return item.source === 'builtin' && !item.customized
    ? { ...item, name: t(item.name), prompt: t(item.prompt, { language: '{{language}}' }) }
    : item
}

export function listFunctions(config, { entry, context, includeDisabled = false } = {}) {
  const overrides = config.browserFunctionOverrides || {}
  const presets = FUNCTION_PRESETS.filter((item) => item.id !== 'preset.selection').map((item) => ({
    ...item,
    source: 'builtin',
    engine: '',
    enabled: true,
    iconKey:
      item.scope === 'input'
        ? 'polish'
        : item.output === 'annotations'
        ? 'book'
        : item.scope === 'url'
        ? 'globe'
        : 'summary',
  }))
  const builtins = selectionDefinitions.map(([key, name, prompt]) => ({
    id: `builtin.${key}`,
    name,
    prompt,
    scope: 'selection',
    output: 'chat',
    engine: '',
    source: 'builtin',
    legacyKey: key,
    iconKey: key,
    enabled: (config.activeSelectionTools || []).includes(key),
  }))
  const legacy = (config.customSelectionTools || []).flatMap((item, index) =>
    item?.name
      ? [
          {
            id: `legacy.${index}`,
            name: item.name,
            prompt: item.prompt,
            scope: 'selection',
            selectionOrPage: item.usePageContext === true,
            template: true,
            output: 'chat',
            engine: '',
            enabled: item.active !== false,
            iconKey: item.iconKey || 'ask',
            source: 'legacy',
            legacyIndex: index,
          },
        ]
      : [],
  )
  const saved = (config.browserAssistantFunctions || []).map((item) => ({
    ...item,
    source: 'custom',
  }))
  return [...presets, ...builtins, ...legacy, ...saved]
    .map((item) => {
      const value = {
        ...item,
        ...overrides[item.id],
        entries: overrides[item.id]?.entries || item.entries || DEFAULT_ENTRIES,
      }
      if (context && value.selectionOrPage) value.scope = context.selection ? 'selection' : 'page'
      return value
    })
    .filter(
      (item) =>
        (includeDisabled || item.enabled !== false) && (!entry || item.entries.includes(entry)),
    )
}

export function findFunction(config, id, context) {
  const key =
    id === 'preset.selection'
      ? 'builtin.explain'
      : id === 'summarizePage'
      ? 'preset.page-overview'
      : selectionDefinitions.some(([value]) => value === id)
      ? `builtin.${id}`
      : id?.startsWith('custom_')
      ? `legacy.${id.slice(7)}`
      : id
  return listFunctions(config, { context, includeDisabled: true }).find((item) => item.id === key)
}

export function canRunFunction(item, context) {
  return item.scope === 'selection'
    ? !!context.selection || item.selectionOrPage
    : item.scope === 'input'
    ? !!context.input
    : true
}

export function updateFunctionPatch(config, item, patch) {
  if (item.source === 'builtin') {
    return {
      browserFunctionOverrides: {
        ...config.browserFunctionOverrides,
        [item.id]: { ...config.browserFunctionOverrides?.[item.id], ...patch },
      },
    }
  }
  if (item.source === 'legacy') {
    const customSelectionTools = [...config.customSelectionTools]
    if ('enabled' in patch)
      customSelectionTools[item.legacyIndex] = {
        ...customSelectionTools[item.legacyIndex],
        active: patch.enabled,
      }
    return {
      customSelectionTools,
      browserFunctionOverrides: {
        ...config.browserFunctionOverrides,
        [item.id]: { ...config.browserFunctionOverrides?.[item.id], ...patch },
      },
    }
  }
  return {
    browserAssistantFunctions: (config.browserAssistantFunctions || []).map((value) =>
      value.id === item.id ? validateFunction({ ...value, ...patch }) : value,
    ),
  }
}

export function saveFunctionPatch(config, draft) {
  const copy =
    draft.source === 'builtin' ||
    draft.id.startsWith('preset.') ||
    draft.id.startsWith('builtin.') ||
    draft.id.startsWith('legacy.')
  const item = copy ? createFunction({ ...draft, id: undefined }) : validateFunction(draft)
  const patch = {
    browserAssistantFunctions: [
      ...(config.browserAssistantFunctions || []).filter((value) => value.id !== item.id),
      item,
    ],
  }
  if (draft.source === 'legacy') Object.assign(patch, withoutLegacy(config, draft.legacyIndex))
  return { item, patch }
}

export function deleteFunctionPatch(config, item) {
  if (item.source === 'legacy') return withoutLegacy(config, item.legacyIndex)
  return {
    browserAssistantFunctions: (config.browserAssistantFunctions || []).filter(
      (value) => value.id !== item.id,
    ),
  }
}

function withoutLegacy(config, removed) {
  const overrides = {}
  for (const [id, value] of Object.entries(config.browserFunctionOverrides || {})) {
    const match = /^legacy\.(\d+)$/.exec(id)
    if (!match) overrides[id] = value
    else if (Number(match[1]) !== removed)
      overrides[`legacy.${Number(match[1]) > removed ? Number(match[1]) - 1 : match[1]}`] = value
  }
  return {
    customSelectionTools: config.customSelectionTools.filter((_, index) => index !== removed),
    browserFunctionOverrides: overrides,
  }
}
