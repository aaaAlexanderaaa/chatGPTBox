import { parse } from 'acorn'

export function functionNode(source) {
  try {
    const node = parse(`(${source})`, { ecmaVersion: 'latest' }).body[0].expression
    return ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.type) ? node : null
  } catch {
    try {
      return parse(`({${source}})`, { ecmaVersion: 'latest' }).body[0].expression.properties[0]
        .value
    } catch {
      return null
    }
  }
}

export function visit(node, callback, descendFunctions = true) {
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

function identifier(node, name) {
  return node?.type === 'Identifier' && node.name === name
}

function member(node, object, property) {
  return (
    node?.type === 'MemberExpression' &&
    identifier(node.object, object) &&
    (node.computed ? node.property?.value : node.property?.name) === property
  )
}

function terms(node, operator) {
  return node?.type === 'LogicalExpression' && node.operator === operator
    ? [...terms(node.left, operator), ...terms(node.right, operator)]
    : [node]
}

function declaration(statement) {
  return statement?.type === 'VariableDeclaration' && statement.declarations.length === 1
    ? statement.declarations[0]
    : null
}

function unboundCallee(node) {
  return node?.type === 'SequenceExpression' &&
    node.expressions.length === 2 &&
    node.expressions[0].value === 0
    ? node.expressions[1]
    : node
}

function mutates(node, names, allowed) {
  let changed = false
  visit(
    node,
    (entry) => {
      if (entry === allowed) return
      let target =
        entry.type === 'AssignmentExpression'
          ? entry.left
          : entry.type === 'UpdateExpression'
          ? entry.argument
          : null
      while (target?.type === 'MemberExpression') target = target.object
      if (target?.type === 'Identifier' && names.has(target.name)) changed = true
    },
    false,
  )
  return changed
}

// The October 31 frontend delegates tracking to a diagnostics helper. Its
// decorated branch is restricted to the site's /ces/v1/rgstr telemetry URL;
// other requests return the supplied fetch(url, options) directly. Recognize
// that branch boundary and the single attempt, rather than accepting any helper
// merely because the caller passes fetch as an argument.
export function hasCompatibleChatgptWebFetchDelegate(source, moduleSource) {
  const fn = functionNode(source)
  const factory = functionNode(moduleSource)
  if (
    !fn?.async ||
    fn.params.length !== 3 ||
    fn.params.some((parameter) => parameter.type !== 'Identifier') ||
    fn.body?.body?.length !== 7 ||
    !factory?.body?.body
  )
    return false
  const [url, options, send] = fn.params.map((parameter) => parameter.name)
  const [setup, inactive, decorate, skipped, metadata, attempt, settled] = fn.body.body
  const response = setup.declarations?.[0]?.id?.name
  const configuration = setup.declarations?.[2]?.id?.name
  const decoration = declaration(decorate)
  const diagnostic = decoration?.id?.name
  const gate = decoration?.init?.callee
  let invalidSetup = false
  visit(setup, (node) => {
    if (/^(?:Call|New|Assignment|Update|Await|Yield)Expression$/.test(node.type))
      invalidSetup = true
  })
  const forwards = (node) =>
    node?.type === 'CallExpression' &&
    identifier(node.callee, send) &&
    node.arguments.length === 2 &&
    identifier(node.arguments[0], url) &&
    identifier(node.arguments[1], options)
  const fallback = (node, condition) =>
    node?.type === 'IfStatement' &&
    !node.alternate &&
    node.test?.type === 'UnaryExpression' &&
    node.test.operator === '!' &&
    identifier(node.test.argument, condition) &&
    node.consequent?.type === 'ReturnStatement' &&
    forwards(node.consequent.argument)
  if (
    setup.type !== 'VariableDeclaration' ||
    invalidSetup ||
    setup.declarations.length !== 3 ||
    !response ||
    setup.declarations[0].init ||
    !configuration ||
    setup.declarations[2].init?.type !== 'Identifier' ||
    !fallback(inactive, configuration) ||
    !diagnostic ||
    gate?.type !== 'FunctionExpression' ||
    gate.async ||
    gate.params.length !== 3 ||
    gate.params.some((parameter) => parameter.type !== 'Identifier') ||
    decoration.init.arguments.length !== 3 ||
    !decoration.init.arguments.every((argument, index) =>
      identifier(argument, [configuration, url, options][index]),
    ) ||
    !fallback(skipped, diagnostic) ||
    declaration(metadata)?.init?.type !== 'ArrowFunctionExpression'
  )
    return false
  const guard = gate.body?.body?.[0]
  const guarded = guard?.block?.body
  const parsed = declaration(guarded?.[1])
  const routeGuard = guarded?.[2]
  const parser = factory.body.body.find(
    (node) => node.type === 'FunctionDeclaration' && identifier(parsed?.init?.callee, node.id.name),
  )
  const parsedUrl = parser?.body?.body?.[0]?.declarations?.[0]
  const result = parser?.body?.body?.[1]?.argument
  const route = terms(result?.test, '&&')
  const equal = (node, object, property, value) =>
    node?.type === 'BinaryExpression' &&
    node.operator === '===' &&
    ((member(node.left, object, property) && node.right?.value === value) ||
      (member(node.right, object, property) && node.left?.value === value))
  const locationMember = (node, property) =>
    node?.type === 'MemberExpression' &&
    member(node.object, 'window', 'location') &&
    (node.computed ? node.property?.value : node.property?.name) === property
  if (
    gate.body.body.length !== 1 ||
    guard.type !== 'TryStatement' ||
    guard.finalizer ||
    guard.handler?.body?.body?.length !== 1 ||
    guard.handler.body.body[0].type !== 'ReturnStatement' ||
    guard.handler.body.body[0].argument ||
    guarded?.[0]?.type !== 'IfStatement' ||
    guarded[0].alternate ||
    guarded[0].consequent?.type !== 'ReturnStatement' ||
    guarded[0].consequent.argument ||
    parsed?.id?.type !== 'Identifier' ||
    parsed.init?.arguments?.length !== 1 ||
    !identifier(parsed.init.arguments[0], gate.params[1].name) ||
    routeGuard?.type !== 'IfStatement' ||
    routeGuard.alternate ||
    routeGuard.consequent?.type !== 'ReturnStatement' ||
    routeGuard.consequent.argument ||
    routeGuard.test?.type !== 'LogicalExpression' ||
    routeGuard.test.operator !== '||' ||
    routeGuard.test.left?.operator !== '!' ||
    !identifier(routeGuard.test.left.argument, parsed.id.name) ||
    parser?.async ||
    parser?.params?.length !== 1 ||
    parser.params[0].type !== 'Identifier' ||
    parser.body.body.length !== 2 ||
    parsedUrl?.id?.type !== 'Identifier' ||
    parsedUrl.init?.type !== 'NewExpression' ||
    !identifier(parsedUrl.init.callee, 'URL') ||
    parsedUrl.init.arguments.length !== 2 ||
    !identifier(parsedUrl.init.arguments[0], parser.params[0].name) ||
    !locationMember(parsedUrl.init.arguments[1], 'href') ||
    parser.body.body[0].declarations.length !== 1 ||
    parser.body.body[1].type !== 'ReturnStatement' ||
    result?.type !== 'ConditionalExpression' ||
    !identifier(result.consequent, parsedUrl.id.name) ||
    result.alternate?.operator !== 'void' ||
    result.alternate.argument?.value !== 0 ||
    route.length !== 4 ||
    !route.some((term) => equal(term, parsedUrl.id.name, 'pathname', '/ces/v1/rgstr')) ||
    !route.some((term) => equal(term, parsedUrl.id.name, 'username', '')) ||
    !route.some((term) => equal(term, parsedUrl.id.name, 'password', '')) ||
    !route.some(
      (term) =>
        term.type === 'BinaryExpression' &&
        term.operator === '===' &&
        member(term.left, parsedUrl.id.name, 'origin') &&
        locationMember(term.right, 'origin'),
    )
  )
    return false
  const calls = []
  let ownsFunction = false
  let invalidCall = false
  visit(factory.body, (node) => {
    if (
      node.type === 'FunctionDeclaration' &&
      moduleSource.slice(node.start - 1, node.end - 1) === source
    )
      ownsFunction = true
    if (
      node.type === 'CallExpression' &&
      (identifier(node.callee, 'fetch') ||
        (node.callee?.type === 'MemberExpression' &&
          ['fetch', 'sendBeacon'].includes(node.callee.property?.name)))
    )
      invalidCall = true
  })
  visit(fn.body, (node) => {
    if (node.type === 'CallExpression' && identifier(node.callee, send)) calls.push(node)
  })
  const assignment = attempt.block?.body?.[0]?.expression
  const fetched = assignment?.right?.argument
  const thrown = attempt.handler?.body?.body?.[0]
  const stable = new Set([url, options, send, configuration, diagnostic, response])
  const shadows = gate.params.map((parameter) => parameter.name)
  return (
    ownsFunction &&
    !invalidCall &&
    !mutates(fn.body, stable, assignment) &&
    !mutates(
      gate.body,
      new Set([
        ...[url, options, send].filter((name) => !shadows.includes(name)),
        gate.params[1].name,
        gate.params[2].name,
      ]),
    ) &&
    !mutates(attempt.handler?.body, new Set([attempt.handler?.param?.name])) &&
    calls.length === 3 &&
    attempt.type === 'TryStatement' &&
    !attempt.finalizer &&
    attempt.block.body.length === 1 &&
    assignment?.type === 'AssignmentExpression' &&
    assignment.operator === '=' &&
    identifier(assignment.left, response) &&
    assignment.right?.type === 'AwaitExpression' &&
    fetched?.type === 'CallExpression' &&
    identifier(fetched.callee, send) &&
    fetched.arguments.length === 2 &&
    member(fetched.arguments[0], diagnostic, 'url') &&
    identifier(fetched.arguments[1], options) &&
    attempt.handler?.param?.type === 'Identifier' &&
    attempt.handler.body.body.length === 1 &&
    thrown.type === 'ThrowStatement' &&
    thrown.argument?.type === 'SequenceExpression' &&
    identifier(thrown.argument.expressions.at(-1), attempt.handler.param.name) &&
    settled.type === 'ReturnStatement' &&
    settled.argument?.type === 'SequenceExpression' &&
    identifier(settled.argument.expressions.at(-1), response)
  )
}

// Recognize the reviewed tracking wrapper by its behavior, with synthetic/local
// names allowed. Its only call that can do I/O must be fetch(url, options), once.
// Metadata uses a private WeakMap; the original response/error is returned/thrown.
export function hasCompatibleChatgptWebFetchWrapper(source, moduleSource, delegates = []) {
  const fn = functionNode(source)
  const factory = functionNode(moduleSource)
  if (
    !fn?.async ||
    fn.params.length !== 3 ||
    fn.params.some((parameter) => parameter.type !== 'Identifier') ||
    fn.body?.body?.length !== 2 ||
    !factory?.body?.body
  )
    return false
  const metadata = declaration(fn.body.body[0])
  if (
    metadata?.id?.type !== 'Identifier' ||
    metadata.init?.type !== 'ObjectExpression' ||
    metadata.init.properties.length !== 2 ||
    metadata.init.properties.some(
      (property) =>
        property.type !== 'Property' ||
        property.computed ||
        property.kind !== 'init' ||
        !['Identifier', 'Literal'].includes(property.value.type),
    )
  )
    return false
  const properties = Object.fromEntries(
    metadata.init.properties.map((property) => [
      property.key.name || property.key.value,
      property.value,
    ]),
  )
  if (
    properties.cloudflareJsdStateAtRequestStart?.type !== 'Identifier' ||
    !identifier(properties.requestAttempt, fn.params[2].name)
  )
    return false
  const attempt = fn.body.body[1]
  if (
    attempt.type !== 'TryStatement' ||
    attempt.finalizer ||
    attempt.block.body.length !== 2 ||
    attempt.handler?.param?.type !== 'Identifier' ||
    attempt.handler.body.body.length !== 1
  )
    return false
  const response = declaration(attempt.block.body[0])
  const call = response?.init?.argument
  if (
    response?.id?.type !== 'Identifier' ||
    response.init.type !== 'AwaitExpression' ||
    call?.type !== 'CallExpression' ||
    !(
      (identifier(call.callee, 'fetch') && call.arguments.length === 2) ||
      (delegates.some((delegate) =>
        member(unboundCallee(call.callee), delegate.object, delegate.property),
      ) &&
        call.arguments.length === 4 &&
        identifier(call.arguments[2], 'fetch') &&
        identifier(call.arguments[3], fn.params[2].name))
    ) ||
    !call.arguments
      .slice(0, 2)
      .every((argument, index) => identifier(argument, fn.params[index].name))
  )
    return false
  const returned = attempt.block.body[1]
  const sequence = returned.argument?.expressions
  const tracking = sequence?.[0]
  const store = tracking?.callee?.object?.name
  const tracks = (node, value) =>
    node?.type === 'CallExpression' &&
    member(node.callee, store, 'set') &&
    node.arguments.length === 2 &&
    identifier(node.arguments[0], value) &&
    identifier(node.arguments[1], metadata.id.name)
  if (
    returned.type !== 'ReturnStatement' ||
    returned.argument?.type !== 'SequenceExpression' ||
    sequence.length !== 2 ||
    !identifier(sequence[1], response.id.name) ||
    !store ||
    !tracks(tracking, response.id.name)
  )
    return false
  const thrown = attempt.handler.body.body[0]
  const error = attempt.handler.param.name
  const guards = terms(thrown.argument?.expressions?.[0], '&&')
  if (
    thrown.type !== 'ThrowStatement' ||
    thrown.argument?.type !== 'SequenceExpression' ||
    thrown.argument.expressions.length !== 2 ||
    !identifier(thrown.argument.expressions[1], error) ||
    guards.length !== 3 ||
    !['!=', '!=='].includes(guards[0]?.operator) ||
    !(
      (guards[0].left?.value === null && identifier(guards[0].right, error)) ||
      (guards[0].right?.value === null && identifier(guards[0].left, error))
    ) ||
    !['==', '==='].includes(guards[1]?.operator) ||
    !(
      (guards[1].left?.value === 'object' &&
        guards[1].right?.operator === 'typeof' &&
        identifier(guards[1].right.argument, error)) ||
      (guards[1].right?.value === 'object' &&
        guards[1].left?.operator === 'typeof' &&
        identifier(guards[1].left.argument, error))
    ) ||
    !tracks(guards[2], error)
  )
    return false
  const privateStore = factory.body.body
    .flatMap((node) => node.declarations || [])
    .find((node) => identifier(node.id, store))
  let changed = false
  let ownsFunction = false
  visit(factory.body, (node) => {
    if (
      (node.type === 'AssignmentExpression' &&
        (identifier(node.left, store) || node.left?.object?.name === store)) ||
      (node.type === 'UpdateExpression' && identifier(node.argument, store))
    )
      changed = true
    if (
      node.type === 'FunctionDeclaration' &&
      moduleSource.slice(node.start - 1, node.end - 1) === source
    )
      ownsFunction = true
  })
  return (
    ownsFunction &&
    !changed &&
    privateStore?.init?.type === 'NewExpression' &&
    identifier(privateStore.init.callee, 'WeakMap') &&
    privateStore.init.arguments.length === 0
  )
}

export function getChatgptWebFetchWrappers(module, modules) {
  return importedFunctions(module, modules, (dependency) => {
    const delegates = importedFunctions(dependency, modules, (delegate) =>
      Object.entries(delegate.functions || {}).filter(([, source]) =>
        hasCompatibleChatgptWebFetchDelegate(source, delegate.source),
      ),
    )
    return Object.entries(dependency.functions || {})
      .filter(([, source]) =>
        hasCompatibleChatgptWebFetchWrapper(source, dependency.source, delegates),
      )
      .map(([name, source]) => [name, source, delegates])
  })
}

function importedFunctions(module, modules, select) {
  const factory = functionNode(module.source)
  const loader = factory?.params?.[2]?.name
  if (!loader) return []
  const bindings = (factory.body?.body || [])
    .flatMap((node) => node.declarations || [])
    .filter(
      (node) =>
        node.id?.type === 'Identifier' &&
        node.init?.type === 'CallExpression' &&
        identifier(node.init.callee, loader) &&
        node.init.arguments.length === 1 &&
        typeof node.init.arguments[0].value === 'string',
    )
  return bindings.flatMap((binding) => {
    const dependency = modules.find((entry) => entry.id === binding.init.arguments[0].value)
    if (!dependency) return []
    return select(dependency).map(([name, source, delegates]) => ({
      object: binding.id.name,
      property: name,
      module: dependency.id,
      export: name,
      source,
      moduleSource: dependency.source,
      ...(delegates?.length ? { delegates } : {}),
    }))
  })
}

// Only expressions that execute on every path to the first request can prove
// identity/assertion checks. In particular, a loop body or an if branch cannot.
function eager(node, callback) {
  if (!node || typeof node !== 'object' || /Function/.test(node.type || '')) return
  callback(node)
  if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
    eager(node.test, callback)
  } else if (node.type === 'LogicalExpression') {
    eager(node.left, callback)
  } else if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    eager(node.right, callback)
  } else if (/^(?:For|While|DoWhile|Switch|Try)Statement$/.test(node.type)) {
    // No evidence is inferred from paths that may not execute or may catch errors.
  } else {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => eager(child, callback))
      else if (value && typeof value === 'object') eager(value, callback)
    }
  }
}

export function hasCompatibleChatgptWebNativeFetch(source, wrappers = []) {
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
  const isRequest = (node) =>
    node?.type === 'CallExpression' &&
    (identifier(node.callee, 'fetch') ||
      wrappers.some((wrapper) =>
        member(unboundCallee(node.callee), wrapper.object, wrapper.property),
      ))
  const calls = nodes.filter(isRequest)
  const first = nodes.find(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init?.type === 'AwaitExpression' &&
      isRequest(node.init.argument),
  )
  if (!first || calls[0] !== first.init.argument) return false
  const response = first.id.name
  const flag = nodes.find(
    (node) =>
      node.type === 'VariableDeclarator' &&
      terms(node.init, '||').some(
        (term) =>
          term?.type === 'BinaryExpression' &&
          term.operator === '===' &&
          ((term.left?.value === 'never' && member(term.right, options, 'retry')) ||
            (term.right?.value === 'never' && member(term.left, options, 'retry'))),
      ),
  )
  if (!flag?.id?.name) return false
  const stop = fn.body.body.find(
    (node) =>
      node.type === 'IfStatement' &&
      node.start > first.end &&
      terms(node.test, '||').some((term) => identifier(term, flag.id.name)) &&
      node.consequent?.type === 'ReturnStatement' &&
      identifier(node.consequent.argument, response),
  )
  if (
    !stop ||
    flag.end > stop.start ||
    calls.slice(1).some((call) => call.start < stop.end) ||
    nodes.some(
      (node) =>
        node.start < stop.end &&
        ((node.type === 'AssignmentExpression' &&
          [flag.id.name, response].some((name) => identifier(node.left, name))) ||
          (node.type === 'UpdateExpression' &&
            [flag.id.name, response].some((name) => identifier(node.argument, name)))),
    )
  )
    return false
  const before = []
  for (const statement of fn.body.body) {
    if (statement.start > first.start) break
    eager(statement, (node) => {
      if (node.start < first.start) before.push(node)
    })
  }
  const checksIdentity = before.some(
    (node) =>
      node.type === 'CallExpression' &&
      node.arguments.some((argument) => member(argument, options, 'expectedIdentity')),
  )
  const callsAssertion = before.some(
    (node) => node.type === 'CallExpression' && identifier(node.callee, assertion),
  )
  const input = first.init.argument.arguments[1]
  const inputObject =
    input?.type === 'ObjectExpression'
      ? input
      : before.find(
          (node) => node.type === 'VariableDeclarator' && identifier(node.id, input?.name),
        )?.init
  if (
    nodes.some(
      (node) =>
        node.start < first.start &&
        node.type === 'AssignmentExpression' &&
        ((input?.type === 'Identifier' &&
          (identifier(node.left, input.name) || member(node.left, input.name, 'signal'))) ||
          identifier(node.left, assertion)),
    )
  )
    return false
  const passesSignal = inputObject?.properties?.some(
    (node) =>
      node.type === 'Property' &&
      (node.key.name || node.key.value) === 'signal' &&
      member(node.value, options, 'signal'),
  )
  return checksIdentity && callsAssertion && !!passesSignal
}
