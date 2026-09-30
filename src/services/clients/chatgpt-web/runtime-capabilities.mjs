import { parse } from 'acorn'

function visit(node, callback, descendFunctions = true) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, callback, descendFunctions))
    return
  }
  if (typeof node.type !== 'string') return
  callback(node)
  if (!descendFunctions && /Function/.test(node.type)) return
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') visit(value, callback, descendFunctions)
  }
}

function functionNode(source) {
  try {
    return parse(`(${source})`, { ecmaVersion: 'latest' }).body[0].expression
  } catch {
    try {
      return parse(`({${source}})`, { ecmaVersion: 'latest' }).body[0].expression.properties[0]
        .value
    } catch {
      return null
    }
  }
}

function member(node, object, property) {
  return (
    node?.type === 'MemberExpression' &&
    node.object?.name === object &&
    (node.computed ? node.property?.value : node.property?.name) === property
  )
}

function orTerms(node) {
  return node?.type === 'LogicalExpression' && node.operator === '||'
    ? [...orTerms(node.left), ...orTerms(node.right)]
    : [node]
}

// Check the branch we actually use, rather than a hash of the entire function.
// Compatible optional parameters and changes after the no-retry return are allowed.
export function hasCompatibleChatgptWebNativeFetch(source) {
  const fn = functionNode(source)
  if (
    !fn?.async ||
    fn.params.length < 4 ||
    fn.params.slice(0, 4).some((parameter) => parameter.type !== 'Identifier')
  )
    return false
  const options = fn.params[1].name
  const assertion = fn.params[3].name
  const nodes = []
  visit(fn.body, (node) => nodes.push(node), false)
  const requests = nodes.filter(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init?.type === 'AwaitExpression' &&
      node.init.argument?.type === 'CallExpression' &&
      node.init.argument.callee?.name === 'fetch',
  )
  if (!requests.length) return false
  const first = requests[0]
  const response = first.id.name
  const flag = nodes.find(
    (node) =>
      node.type === 'VariableDeclarator' &&
      orTerms(node.init).some(
        (term) =>
          term?.type === 'BinaryExpression' &&
          term.operator === '===' &&
          ((term.left?.value === 'never' && member(term.right, options, 'retry')) ||
            (term.right?.value === 'never' && member(term.left, options, 'retry'))),
      ),
  )
  if (!flag?.id?.name) return false
  const stop = nodes.find(
    (node) =>
      node.type === 'IfStatement' &&
      node.start > first.end &&
      orTerms(node.test).some(
        (term) => term?.type === 'Identifier' && term.name === flag.id.name,
      ) &&
      node.consequent?.type === 'ReturnStatement' &&
      node.consequent.argument?.name === response,
  )
  if (!stop || requests.slice(1).some((request) => request.start < stop.end)) return false
  const checksIdentity = nodes.some(
    (node) =>
      node.type === 'CallExpression' &&
      node.start < first.start &&
      node.arguments.some((argument) => member(argument, options, 'expectedIdentity')),
  )
  const callsAssertion = nodes.some(
    (node) =>
      node.type === 'CallExpression' && node.start < first.start && node.callee?.name === assertion,
  )
  const passesSignal = nodes.some(
    (node) =>
      node.type === 'Property' &&
      (node.key.name || node.key.value) === 'signal' &&
      member(node.value, options, 'signal'),
  )
  return checksIdentity && callsAssertion && passesSignal
}

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

function reachable(graph, start, destination) {
  const queue = [[start, 0]]
  const seen = new Set()
  while (queue.length && seen.size < 256) {
    const [id, depth] = queue.shift()
    if (id === destination) return true
    if (seen.has(id) || depth >= 6) continue
    seen.add(id)
    for (const next of graph?.[id] || []) queue.push([next, depth + 1])
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
          module.source.includes('codex_webview'),
      )
      const auths = modules.filter((module) =>
        [
          'loadBrowserChatGptAuth',
          'getBrowserChatGptAuthSnapshot',
          'isSameBrowserRequestAuthContext',
        ].every((key) => module.functions?.[key]),
      )
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
      const fetches = modules.flatMap((module) =>
        Object.entries(module.functions || {})
          .filter(([, source]) => hasCompatibleChatgptWebNativeFetch(source))
          .map(([name, source]) => ({ module, name, source })),
      )
      if (requests.length !== 1 || auths.length !== 1 || integrities.length !== 1) continue
      const connected = fetches.filter((entry) =>
        reachable(runtime.graph, requests[0].id, entry.module.id),
      )
      if (connected.length !== 1) continue
      const native = connected[0]
      const integrity = integrities[0]
      matches.push({
        filename: url.pathname.split('/').pop(),
        kind: 'rspack',
        profile: 'codex-webview',
        requestModule: requests[0].id,
        authModule: auths[0].id,
        integrityModule: integrity.module.id,
        integrityPrepareExport: integrity.prepare[0],
        integrityHeadersExport: integrity.headers[0],
        fetchModule: native.module.id,
        fetchExport: native.name,
        capabilityCheck: {
          fetchSource: native.source,
          prepareSource: integrity.prepare[1],
          headersSource: integrity.headers[1],
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
