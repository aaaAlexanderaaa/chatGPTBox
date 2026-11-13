import { EngineOperation as Op } from './contract.mjs'
import { CHATGPT_WEB_THINKING_EFFORTS } from '../services/clients/chatgpt-web/thinking.mjs'

const operation = (semanticProfile, extra = {}) => ({
  implemented: true,
  semanticProfile,
  ...extra,
})
const generated = operation('prompt-generation/1')
const appended = operation('bound-conversation-append/1')
const history = operation('native-history/1')
const chatgptExternalResources = [
  'chatgptweb.projects.list',
  'chatgptweb.attachments.upload',
  'chatgptweb.history.sync',
]
const object = (properties) => ({ type: 'object', properties, additionalProperties: false })
const textInput = (maxPromptCharacters, maxAttachments) => ({
  ...object({
    prompt: {
      type: 'string',
      minLength: 1,
      ...(maxPromptCharacters ? { maxLength: maxPromptCharacters } : {}),
    },
    attachments: { type: 'array', maxItems: maxAttachments },
  }),
  required: ['prompt'],
})

// Metadata is shared with configuration and settings. Native methods live only
// in the background adapter registry; Node never imports browser integrations.
export const WEB_ENGINE_DEFINITIONS = Object.freeze([
  {
    id: 'chatgptweb',
    label: 'ChatGPT Web',
    route: 'chatgpt-web',
    enabledKey: 'chatgptWebEnabled',
    defaultEnabled: true,
    legacyDefault: true,
    inputSchema: textInput(null, 4),
    parameterSchema: object({
      thinkingEffort: { type: 'string', enum: [...CHATGPT_WEB_THINKING_EFFORTS] },
    }),
    extensionSchema: object({
      chatgptweb: object({
        projectId: { type: 'string', minLength: 1 },
        historyDisabled: { type: 'boolean' },
      }),
    }),
    operations: {
      [Op.Generate]: generated,
      [Op.Append]: appended,
      [Op.ReadConversation]: history,
      [Op.ListConversations]: history,
      [Op.RecoverRun]: operation('exact-turn-read/1'),
    },
    execution: { concurrencyScope: 'conversation' },
    resultFormats: ['markdown', 'safe-html'],
    cancellationGuarantee: 'local-observation',
    modelPolicy: 'catalog-and-explicit-selection',
    extensionOperations: [
      ...chatgptExternalResources,
      'chatgptweb.conversation.delete',
      'chatgptweb.message.feedback',
    ],
    externalExtensionOperations: chatgptExternalResources,
    legacyExternalOperations: [
      Op.Generate,
      Op.Append,
      Op.ReadConversation,
      Op.ListConversations,
      ...chatgptExternalResources,
    ],
  },
  {
    id: 'grokweb',
    inputSchema: textInput(null, 0),
    parameterSchema: object({}),
    extensionSchema: object({}),
    legacyModelPrefixes: ['grok-chat-'],
    label: 'Grok Web',
    route: 'grok-web',
    enabledKey: 'grokWebEnabled',
    defaultEnabled: false,
    operations: {
      [Op.Generate]: generated,
      [Op.Append]: appended,
      [Op.ReadConversation]: history,
      [Op.ListConversations]: history,
      [Op.RecoverRun]: { implemented: false },
    },
    execution: { concurrencyScope: 'engine', maxConcurrent: 1 },
    resultFormats: ['markdown'],
    cancellationGuarantee: 'local-observation',
    modelPolicy: 'account-catalog',
    extensionOperations: [],
    legacyExternalOperations: [Op.Generate, Op.Append, Op.ReadConversation, Op.ListConversations],
  },
  {
    id: 'geminiweb',
    inputSchema: textInput(50000, 0),
    parameterSchema: object({ thinkingEffort: { type: 'string', enum: ['high'] } }),
    extensionSchema: object({}),
    legacyModelPrefixes: ['gemini-'],
    label: 'Gemini Web',
    route: 'gemini-web',
    enabledKey: 'geminiWebEnabled',
    defaultEnabled: false,
    operations: {
      [Op.Generate]: operation('prompt-generation/1', {
        maxPromptCharacters: 50000,
        attachments: false,
      }),
      [Op.Append]: operation('bound-conversation-append/1', { bindingLifetime: 'live-document' }),
      [Op.ReadConversation]: { implemented: false },
      [Op.ListConversations]: { implemented: false },
      [Op.RecoverRun]: { implemented: false },
    },
    execution: { concurrencyScope: 'engine', maxConcurrent: 1 },
    resultFormats: ['safe-html'],
    cancellationGuarantee: 'request-only',
    modelPolicy: 'fixed-verified-selection',
    extensionOperations: [],
    legacyExternalOperations: [Op.Generate],
  },
])

export function engineConfigDefaults(definitions = WEB_ENGINE_DEFINITIONS) {
  return Object.fromEntries(
    definitions.map((definition) => [definition.enabledKey, definition.defaultEnabled]),
  )
}

export function findEngineDefinition(id, definitions = WEB_ENGINE_DEFINITIONS) {
  return definitions.find((definition) => definition.id === id)
}

export function engineIsEnabled(config, definition) {
  const value = config?.[definition.enabledKey]
  return value === true || (value === undefined && definition.defaultEnabled === true)
}

export function operationIsImplemented(definition, name) {
  return (
    definition.operations?.[name]?.implemented === true ||
    definition.extensionOperations?.includes(name)
  )
}
