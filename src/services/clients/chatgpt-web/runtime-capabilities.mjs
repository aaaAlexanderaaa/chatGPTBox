import {
  functionNode,
  visit,
  getChatgptWebFetchWrappers,
  hasCompatibleChatgptWebNativeFetch,
} from './runtime-fetch-capabilities.mjs'

export { hasCompatibleChatgptWebNativeFetch } from './runtime-fetch-capabilities.mjs'

function prepareFunction(source) {
  const fn = functionNode(source)
  if (!fn?.async || fn.params[0]?.type !== 'Identifier') return false
  let returnsRequirements = false
  let callsPrepare = false
  visit(
    fn.body,
    (node) => {
      if (node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression') {
        const keys = node.argument.properties.map(
          (property) => property.key?.name || property.key?.value,
        )
        if (['chatRequirements', 'proofToken', 'turnstileToken'].every((key) => keys.includes(key)))
          returnsRequirements = true
      }
      if (node.type === 'CallExpression' && node.callee?.name === fn.params[0].name)
        callsPrepare = true
    },
    false,
  )
  return returnsRequirements && callsPrepare
}

function headersFunction(source) {
  const fn = functionNode(source)
  if (!fn || fn.async || fn.params.length !== 3) return false
  const names = new Set()
  visit(
    fn.body,
    (node) => {
      if (node.type === 'MemberExpression')
        names.add(node.computed ? node.property?.value : node.property?.name)
    },
    false,
  )
  return ['chatRequirementsToken', 'proofToken', 'turnstileToken'].every((name) => names.has(name))
}

function browserRequestProfile(source) {
  const fn = functionNode(source)
  if (!fn || fn.async || fn.params.length !== 1 || fn.params[0].type !== 'Identifier') return false
  const returned = fn.body?.body?.find((node) => node.type === 'ReturnStatement')?.argument
  if (
    returned?.type !== 'CallExpression' ||
    returned.callee?.type !== 'MemberExpression' ||
    returned.callee.computed ||
    returned.callee.property?.name !== 'parse' ||
    returned.arguments.length !== 1 ||
    returned.arguments[0]?.type !== 'ObjectExpression'
  )
    return false
  const properties = returned.arguments[0].properties
  if (
    properties.length !== 4 ||
    properties.some((property) => property.type !== 'Property' || property.computed)
  )
    return false
  const fields = Object.fromEntries(
    properties.map((property) => [property.key.name || property.key.value, property.value]),
  )
  // The October 16 page renamed the former codex_webview request profile.
  // Recognize the account-bound browser/native profile builder, not filenames
  // or an occurrence of the new labels in an unrelated module.
  return (
    fields.kind?.type === 'ConditionalExpression' &&
    fields.kind.consequent?.value === 'chatgpt-native' &&
    fields.kind.alternate?.value === 'chatgpt-browser' &&
    fields.accountId?.type === 'Identifier' &&
    fields.accountId.name === fn.params[0].name &&
    fields.language?.type === 'MemberExpression' &&
    fields.deviceId?.type === 'MemberExpression' &&
    fields.deviceId.computed &&
    fields.deviceId.property?.value === 'oai-did' &&
    fields.deviceId.object?.type === 'Identifier' &&
    fields.deviceId.object.name === fields.language.object?.name
  )
}

function reachable(graph, start, destination) {
  // Follow callers backwards so broad UI/schema dependencies do not exhaust a
  // small forward-search budget before the real transport is visited. The depth
  // bound still applies; each module is visited at most once.
  const callers = new Map()
  for (const [id, dependencies] of Object.entries(graph || {})) {
    for (const dependency of dependencies) {
      if (!callers.has(dependency)) callers.set(dependency, [])
      callers.get(dependency).push(id)
    }
  }
  const queue = [[destination, 0]]
  const seen = new Set()
  for (let index = 0; index < queue.length; index++) {
    const [id, depth] = queue[index]
    if (id === start) return true
    if (seen.has(id) || depth >= 6) continue
    seen.add(id)
    for (const next of callers.get(id) || []) queue.push([next, depth + 1])
  }
  return false
}

export function resolveChatgptWebRuntimeCapabilities(inspections = []) {
  const matches = []
  for (const runtime of inspections) {
    try {
      const url = new URL(runtime.url)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !['chatgpt.com', 'cdn.oaistatic.com'].includes(url.hostname) ||
        !/\/assets\/[^/]+\.js$/.test(url.pathname)
      )
        continue
      const modules = runtime.modules || []
      const requests = modules.filter(
        (module) =>
          module.requestMethods?.getRequestTarget &&
          module.requestMethods?.safePost &&
          (module.source.includes('codex_webview') ||
            browserRequestProfile(module.functions?.getChatGptRequestProfile)),
      )
      const auths = modules.flatMap((module) => {
        const keys = ['loadBrowserChatGptAuth', 'getBrowserChatGptAuthSnapshot']
        if (!keys.every((key) => module.functions?.[key])) return []
        const generation = !module.functions.isSameBrowserRequestAuthContext
        keys.push(
          ...(generation
            ? ['getBrowserChatGptAuthGeneration', 'isBrowserWorkspaceSwitchPending']
            : ['isSameBrowserRequestAuthContext']),
        )
        return keys.every((key) => module.functions[key]) ? [{ module, generation, keys }] : []
      })
      const integrities = modules.flatMap((module) => {
        const prepare = Object.entries(module.functions || {}).filter(([, source]) =>
          prepareFunction(source),
        )
        const headers = Object.entries(module.functions || {}).filter(([, source]) =>
          headersFunction(source),
        )
        return prepare.length === 1 && headers.length === 1
          ? [{ module, prepare: prepare[0], headers: headers[0] }]
          : []
      })
      const fetches = modules.flatMap((module) => {
        const wrappers = getChatgptWebFetchWrappers(module, modules)
        return Object.entries(module.functions || {})
          .filter(([, source]) => hasCompatibleChatgptWebNativeFetch(source, wrappers))
          .map(([name, source]) => ({ module, name, source, wrappers }))
      })
      if (requests.length !== 1 || auths.length !== 1 || integrities.length !== 1) continue
      const connected = fetches.filter((entry) =>
        reachable(runtime.graph, requests[0].id, entry.module.id),
      )
      if (connected.length !== 1) continue
      const native = connected[0]
      const integrity = integrities[0]
      const auth = auths[0]
      matches.push({
        filename: url.pathname.split('/').pop(),
        kind: 'rspack',
        profile: 'codex-webview',
        requestModule: requests[0].id,
        authModule: auth.module.id,
        ...(auth.generation ? { authContext: 'generation' } : {}),
        integrityModule: integrity.module.id,
        integrityPrepareExport: integrity.prepare[0],
        integrityHeadersExport: integrity.headers[0],
        fetchModule: native.module.id,
        fetchExport: native.name,
        capabilityCheck: {
          requestSources: requests[0].requestMethods,
          ...(requests[0].functions?.getChatGptRequestProfile
            ? { requestProfileSource: requests[0].functions.getChatGptRequestProfile }
            : {}),
          fetchSource: native.source,
          prepareSource: integrity.prepare[1],
          headersSource: integrity.headers[1],
          authSources: Object.fromEntries(
            auth.keys.map((key) => [key, auth.module.functions[key]]),
          ),
          ...(native.wrappers.length
            ? {
                fetchModuleSource: native.module.source,
                fetchWrappers: native.wrappers.map(
                  ({ module, export: name, source, moduleSource }) => ({
                    module,
                    export: name,
                    source,
                    moduleSource,
                  }),
                ),
              }
            : {}),
          preflight: true,
        },
      })
    } catch {
      // Unsupported syntax or an incomplete role is a capability failure.
    }
  }
  if (matches.length !== 1) return null
  return matches[0]
}
