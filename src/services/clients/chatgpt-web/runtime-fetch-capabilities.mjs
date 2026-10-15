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

// Recognize the reviewed tracking wrapper by its behavior, with synthetic/local
// names allowed. Its only call that can do I/O must be fetch(url, options), once.
// Metadata uses a private WeakMap; the original response/error is returned/thrown.
export function hasCompatibleChatgptWebFetchWrapper(source, moduleSource) {
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
    !identifier(call.callee, 'fetch') ||
    call.arguments.length !== 2 ||
    !call.arguments.every((argument, index) => identifier(argument, fn.params[index].name))
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
    return Object.entries(dependency.functions || {})
      .filter(([, source]) => hasCompatibleChatgptWebFetchWrapper(source, dependency.source))
      .map(([name, source]) => ({
        object: binding.id.name,
        property: name,
        module: dependency.id,
        export: name,
        source,
        moduleSource: dependency.source,
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
