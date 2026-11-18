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

function mutates(node, names, allowed = null, descendFunctions = false) {
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
    descendFunctions,
  )
  return changed
}

function collectPatternNames(pattern, out) {
  if (!pattern || typeof pattern !== 'object') return
  if (pattern.type === 'Identifier') out.add(pattern.name)
  else if (pattern.type === 'AssignmentPattern') collectPatternNames(pattern.left, out)
  else if (pattern.type === 'RestElement') collectPatternNames(pattern.argument, out)
  else if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) collectPatternNames(element, out)
  } else if (pattern.type === 'ObjectPattern') {
    for (const prop of pattern.properties) {
      collectPatternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out)
    }
  }
}

function collectHoistedVarNames(node, out) {
  visit(
    node,
    (entry) => {
      if (entry.type === 'VariableDeclaration' && entry.kind === 'var') {
        for (const decl of entry.declarations) collectPatternNames(decl.id, out)
      } else if (entry.type === 'FunctionDeclaration' && entry.id) {
        out.add(entry.id.name)
      }
    },
    false,
  )
}

function collectBlockLexicalNames(block, out) {
  for (const statement of block.body || []) {
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') {
      for (const decl of statement.declarations) collectPatternNames(decl.id, out)
    } else if (statement.type === 'FunctionDeclaration' && statement.id) {
      out.add(statement.id.name)
    } else if (statement.type === 'ClassDeclaration' && statement.id) {
      out.add(statement.id.name)
    }
  }
}

function mutatesScoped(node, names, allowed = null, skipTopBindings = true) {
  let changed = false
  function walk(entry, activeNames, isRoot = false) {
    if (!entry || typeof entry !== 'object' || changed) return
    if (Array.isArray(entry)) {
      for (const child of entry) walk(child, activeNames, false)
      return
    }
    if (typeof entry.type !== 'string') return
    if (entry !== allowed) {
      let target =
        entry.type === 'AssignmentExpression'
          ? entry.left
          : entry.type === 'UpdateExpression'
          ? entry.argument
          : null
      while (target?.type === 'MemberExpression') target = target.object
      if (target?.type === 'Identifier' && activeNames.has(target.name)) {
        changed = true
        return
      }
    }
    let nextNames = activeNames
    if (!isRoot && /Function/.test(entry.type)) {
      const shadowed = new Set()
      for (const param of entry.params || []) collectPatternNames(param, shadowed)
      if (entry.body) collectHoistedVarNames(entry.body, shadowed)
      if (shadowed.size) {
        nextNames = new Set([...activeNames].filter((name) => !shadowed.has(name)))
      }
    } else if ((!isRoot || !skipTopBindings) && entry.type === 'BlockStatement') {
      const shadowed = new Set()
      collectBlockLexicalNames(entry, shadowed)
      if (shadowed.size) {
        nextNames = new Set([...activeNames].filter((name) => !shadowed.has(name)))
      }
    } else if (entry.type === 'CatchClause' && entry.param) {
      const shadowed = new Set()
      collectPatternNames(entry.param, shadowed)
      if (shadowed.size) {
        nextNames = new Set([...activeNames].filter((name) => !shadowed.has(name)))
      }
    }
    for (const value of Object.values(entry)) {
      if (value && typeof value === 'object') walk(value, nextNames, false)
    }
  }
  walk(node, new Set(names), true)
  return changed
}

function isUndefinedExpression(node) {
  return (
    (node?.type === 'UnaryExpression' && node.operator === 'void' && node.argument?.value === 0) ||
    identifier(node, 'undefined')
  )
}

function isEmptyReturn(node) {
  return node?.type === 'ReturnStatement' && !node.argument
}

function ownsFactoryFunction(factoryBody, moduleSource, source) {
  let owns = false
  visit(factoryBody, (node) => {
    if (
      ['FunctionDeclaration', 'FunctionExpression'].includes(node.type) &&
      moduleSource.slice(node.start - 1, node.end - 1) === source
    ) {
      owns = true
    }
  })
  return owns
}

function hasInvalidNetworkCalls(factoryBody) {
  let invalid = false
  visit(factoryBody, (node) => {
    if (
      node.type === 'CallExpression' &&
      (identifier(node.callee, 'fetch') ||
        (node.callee?.type === 'MemberExpression' &&
          ['fetch', 'sendBeacon'].includes(node.callee.property?.name)))
    ) {
      invalid = true
    }
  })
  return invalid
}

function equalProperty(node, object, property, value) {
  return (
    node?.type === 'BinaryExpression' &&
    node.operator === '===' &&
    ((member(node.left, object, property) && node.right?.value === value) ||
      (member(node.right, object, property) && node.left?.value === value))
  )
}

function locationMember(node, property) {
  return (
    node?.type === 'MemberExpression' &&
    member(node.object, 'window', 'location') &&
    (node.computed ? node.property?.value : node.property?.name) === property
  )
}

function hasSameOriginCredentialsCheck(routeTerms, parsedUrlName) {
  return (
    routeTerms.some((term) => equalProperty(term, parsedUrlName, 'username', '')) &&
    routeTerms.some((term) => equalProperty(term, parsedUrlName, 'password', '')) &&
    routeTerms.some(
      (term) =>
        term.type === 'BinaryExpression' &&
        term.operator === '===' &&
        ((member(term.left, parsedUrlName, 'origin') && locationMember(term.right, 'origin')) ||
          (member(term.right, parsedUrlName, 'origin') && locationMember(term.left, 'origin'))),
    )
  )
}

function isNotUndefinedComparison(term, name) {
  return (
    term?.type === 'BinaryExpression' &&
    term.operator === '!==' &&
    ((identifier(term.left, name) && isUndefinedExpression(term.right)) ||
      (identifier(term.right, name) && isUndefinedExpression(term.left)))
  )
}

function isSimpleSetup(statement, allowInitCalls = false) {
  if (statement?.type !== 'VariableDeclaration') return false
  let invalid = false
  if (!allowInitCalls) {
    visit(statement, (node) => {
      if (/^(?:Call|New|Assignment|Update|Await|Yield)Expression$/.test(node.type)) invalid = true
    })
  }
  return !invalid
}

function checkAttemptAndSettled(
  attempt,
  settled,
  response,
  send,
  urlArgNode,
  options,
  guardedNames,
) {
  const assignment = attempt?.block?.body?.[0]?.expression
  const fetched = assignment?.right?.argument
  const thrown = attempt?.handler?.body?.body?.[0]
  return (
    attempt?.type === 'TryStatement' &&
    !attempt.finalizer &&
    attempt.block.body.length === 1 &&
    assignment?.type === 'AssignmentExpression' &&
    assignment.operator === '=' &&
    identifier(assignment.left, response) &&
    assignment.right?.type === 'AwaitExpression' &&
    fetched?.type === 'CallExpression' &&
    identifier(fetched.callee, send) &&
    fetched.arguments.length === 2 &&
    urlArgNode(fetched.arguments[0]) &&
    identifier(fetched.arguments[1], options) &&
    attempt.handler?.param?.type === 'Identifier' &&
    attempt.handler.body.body.length === 1 &&
    !mutates(attempt.handler.body, new Set([...guardedNames, attempt.handler.param.name])) &&
    thrown.type === 'ThrowStatement' &&
    thrown.argument?.type === 'SequenceExpression' &&
    identifier(thrown.argument.expressions.at(-1), attempt.handler.param.name) &&
    settled?.type === 'ReturnStatement' &&
    settled.argument?.type === 'SequenceExpression' &&
    identifier(settled.argument.expressions.at(-1), response)
  )
}

const ALLOWED_TELEMETRY_PATHS = new Set(['/ces/v1/rgstr', '/ces/v1/%72gstr'])

export function hasCompatibleChatgptWebTelemetryRoute(source, moduleSource) {
  const fn = functionNode(source)
  const factory = functionNode(moduleSource)
  if (
    !fn ||
    fn.async ||
    fn.params.length !== 1 ||
    fn.params[0].type !== 'Identifier' ||
    fn.body?.body?.length !== 1 ||
    fn.body.body[0]?.type !== 'ReturnStatement' ||
    !factory?.body?.body
  ) {
    return false
  }
  const constants = new Map()
  for (const statement of factory.body.body) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const entry of statement.declarations) {
      if (entry.id?.type === 'Identifier' && typeof entry.init?.value === 'string') {
        constants.set(entry.id.name, entry.init.value)
      }
    }
  }
  if (
    !ownsFactoryFunction(factory.body, moduleSource, source) ||
    hasInvalidNetworkCalls(factory.body) ||
    mutates(factory.body, new Set(constants.keys()), null, true)
  ) {
    return false
  }
  const param = fn.params[0].name
  const matchedPaths = new Set()
  const validChain = (node) => {
    if (isUndefinedExpression(node)) return matchedPaths.size > 0
    if (node?.type !== 'ConditionalExpression') return false
    const test = node.test
    if (test?.type !== 'BinaryExpression' || test.operator !== '===') return false
    const candidate = identifier(test.left, param)
      ? test.right
      : identifier(test.right, param)
      ? test.left
      : null
    const resolved =
      typeof candidate?.value === 'string'
        ? candidate.value
        : candidate?.type === 'Identifier' && candidate.name !== param
        ? constants.get(candidate.name)
        : null
    if (
      !resolved ||
      !ALLOWED_TELEMETRY_PATHS.has(resolved) ||
      typeof node.consequent?.value !== 'string' ||
      !node.consequent.value
    ) {
      return false
    }
    matchedPaths.add(resolved)
    return validChain(node.alternate)
  }
  return validChain(fn.body.body[0].argument) && matchedPaths.has('/ces/v1/rgstr')
}

function hasCompatibleSplitTelemetryGuards(factoryBody, requestGuardName, routes) {
  const requestGuard = factoryBody.body.find(
    (node) => node.type === 'FunctionDeclaration' && identifier(node.id, requestGuardName),
  )
  if (
    !requestGuard ||
    requestGuard.async ||
    requestGuard.params.length !== 2 ||
    requestGuard.params.some((parameter) => parameter.type !== 'Identifier') ||
    requestGuard.body?.body?.length !== 1
  ) {
    return false
  }
  const [reqUrl, reqOptions] = requestGuard.params.map((parameter) => parameter.name)
  const reqCheck = requestGuard.body.body[0]
  const reqCall = reqCheck?.consequent?.argument
  if (
    reqCheck?.type !== 'IfStatement' ||
    reqCheck.alternate ||
    reqCheck.consequent?.type !== 'ReturnStatement' ||
    reqCall?.type !== 'CallExpression' ||
    reqCall.callee?.type !== 'Identifier' ||
    reqCall.arguments.length !== 1 ||
    !identifier(reqCall.arguments[0], reqUrl) ||
    mutates(requestGuard.body, new Set([reqUrl, reqOptions]), null, true)
  ) {
    return false
  }
  const urlGuardName = reqCall.callee.name
  const urlGuard = factoryBody.body.find(
    (node) => node.type === 'FunctionDeclaration' && identifier(node.id, urlGuardName),
  )
  const urlInit = urlGuard?.body?.body?.[0]
  const urlReturn = urlGuard?.body?.body?.[1]?.argument
  if (
    !urlGuard ||
    urlGuard.async ||
    urlGuard.params.length !== 1 ||
    urlGuard.params[0].type !== 'Identifier' ||
    urlGuard.body.body.length !== 2 ||
    urlInit?.type !== 'VariableDeclaration' ||
    urlInit.declarations.length !== 2 ||
    urlGuard.body.body[1]?.type !== 'ReturnStatement' ||
    urlReturn?.type !== 'ConditionalExpression' ||
    !isUndefinedExpression(urlReturn.alternate)
  ) {
    return false
  }
  const [parsedDecl, routeDecl] = urlInit.declarations
  const parsedUrlName = parsedDecl.id?.name
  const routeName = routeDecl.id?.name
  const routeCall = routeDecl.init
  const routeTerms = terms(urlReturn.test, '&&')
  const checksPost =
    reqCheck.test?.type === 'LogicalExpression' &&
    reqCheck.test.operator === '&&' &&
    reqCheck.test.left?.type === 'UnaryExpression' &&
    reqCheck.test.left.operator === '!' &&
    terms(reqCheck.test.left.argument, '||').some((term) => {
      if (term?.type !== 'BinaryExpression' || term.operator !== '!==') return false
      const call =
        term.left?.type === 'ChainExpression'
          ? term.left.expression
          : term.right?.type === 'ChainExpression'
          ? term.right.expression
          : null
      const literal = term.left?.value ?? term.right?.value
      return (
        literal === 'POST' &&
        call?.type === 'CallExpression' &&
        call.callee?.type === 'MemberExpression' &&
        (call.callee.computed ? call.callee.property?.value : call.callee.property?.name) ===
          'toUpperCase' &&
        member(call.callee.object, reqOptions, 'method')
      )
    })
  const protectedNames = new Set([
    requestGuardName,
    urlGuardName,
    ...routes.map((route) => route.object),
  ])
  return (
    checksPost &&
    !mutatesScoped(factoryBody, protectedNames) &&
    parsedUrlName &&
    parsedDecl.init?.type === 'NewExpression' &&
    identifier(parsedDecl.init.callee, 'URL') &&
    parsedDecl.init.arguments.length === 2 &&
    identifier(parsedDecl.init.arguments[0], urlGuard.params[0].name) &&
    locationMember(parsedDecl.init.arguments[1], 'href') &&
    routeName &&
    routeCall?.type === 'CallExpression' &&
    routes.some((route) => member(unboundCallee(routeCall.callee), route.object, route.property)) &&
    routeCall.arguments.length === 1 &&
    member(routeCall.arguments[0], parsedUrlName, 'pathname') &&
    routeTerms.length === 4 &&
    hasSameOriginCredentialsCheck(routeTerms, parsedUrlName) &&
    routeTerms.some((term) => isNotUndefinedComparison(term, routeName)) &&
    urlReturn.consequent?.type === 'ObjectExpression' &&
    !mutatesScoped(urlGuard.body, new Set([urlGuard.params[0].name, parsedUrlName, routeName]))
  )
}

function hasCompatibleFirstRequestGate(node, stable, send) {
  let innerMutation = false
  visit(
    node,
    (entry) => {
      if (entry.type === 'FunctionExpression' || entry.type === 'ArrowFunctionExpression') {
        const paramNames = new Set(entry.params.map((parameter) => parameter.name).filter(Boolean))
        if (mutatesScoped(entry.body, paramNames)) innerMutation = true
      }
      if (entry.type === 'CallExpression' && identifier(entry.callee, send)) innerMutation = true
    },
    true,
  )
  return !innerMutation && !mutatesScoped(node, stable)
}

function hasCompatibleChatgptWebSplitFetchDelegate(source, moduleSource, routes = []) {
  if (!routes.length) return false
  const fn = functionNode(source)
  const factory = functionNode(moduleSource)
  if (
    !fn?.async ||
    fn.params.length !== 3 ||
    fn.params.some((parameter) => parameter.type !== 'Identifier') ||
    ![5, 6].includes(fn.body?.body?.length) ||
    !factory?.body?.body
  ) {
    return false
  }
  const [url, options, send] = fn.params.map((parameter) => parameter.name)
  const [setup, gateStatement, ...restStatements] = fn.body.body
  const [firstRequestGate, skipped, metadata, attempt, settled] =
    fn.body.body.length === 6
      ? [gateStatement, ...restStatements]
      : [null, gateStatement, ...restStatements]
  if (setup.type !== 'VariableDeclaration' || setup.declarations.length !== 4) return false
  const [responseDecl, attemptDecl, configDecl, diagDecl] = setup.declarations
  const response = responseDecl.id?.name
  const configuration = configDecl.id?.name
  const diagnostic = diagDecl.id?.name
  const gateInit = diagDecl.init
  const gate = gateInit?.consequent?.callee
  if (
    !response ||
    responseDecl.init ||
    attemptDecl.id?.type !== 'Identifier' ||
    !isSimpleSetup({ type: 'VariableDeclaration', declarations: [attemptDecl] }) ||
    !configuration ||
    configDecl.init?.type !== 'Identifier' ||
    !diagnostic ||
    gateInit?.type !== 'ConditionalExpression' ||
    !identifier(gateInit.test, configuration) ||
    !isUndefinedExpression(gateInit.alternate) ||
    gateInit.consequent?.type !== 'CallExpression' ||
    gate?.type !== 'FunctionExpression' ||
    gate.async ||
    gate.params.length !== 3 ||
    gate.params.some((parameter) => parameter.type !== 'Identifier') ||
    gateInit.consequent.arguments.length !== 3 ||
    !gateInit.consequent.arguments.every((argument, index) =>
      identifier(argument, [configuration, url, options][index]),
    )
  ) {
    return false
  }
  const guard = gate.body?.body?.[0]
  const guarded = guard?.block?.body
  const parsed = declaration(guarded?.[1])
  const routeGuard = guarded?.[2]
  if (
    gate.body.body.length !== 1 ||
    guard.type !== 'TryStatement' ||
    guard.finalizer ||
    guard.handler?.body?.body?.length !== 1 ||
    !isEmptyReturn(guard.handler.body.body[0]) ||
    guarded?.[0]?.type !== 'IfStatement' ||
    guarded[0].alternate ||
    !isEmptyReturn(guarded[0].consequent) ||
    parsed?.id?.type !== 'Identifier' ||
    parsed.init?.type !== 'CallExpression' ||
    parsed.init.callee?.type !== 'Identifier' ||
    parsed.init.arguments.length !== 2 ||
    !identifier(parsed.init.arguments[0], gate.params[1].name) ||
    !identifier(parsed.init.arguments[1], gate.params[2].name) ||
    routeGuard?.type !== 'IfStatement' ||
    routeGuard.alternate ||
    !isEmptyReturn(routeGuard.consequent) ||
    routeGuard.test?.type !== 'LogicalExpression' ||
    routeGuard.test.operator !== '||' ||
    routeGuard.test.left?.type !== 'UnaryExpression' ||
    routeGuard.test.left.operator !== '!' ||
    !identifier(routeGuard.test.left.argument, parsed.id.name)
  ) {
    return false
  }
  if (!hasCompatibleSplitTelemetryGuards(factory.body, parsed.init.callee.name, routes)) {
    return false
  }
  const forwards = (node) =>
    node?.type === 'CallExpression' &&
    identifier(node.callee, send) &&
    node.arguments.length === 2 &&
    identifier(node.arguments[0], url) &&
    identifier(node.arguments[1], options)
  const isSkippedTest = (test) =>
    test?.type === 'LogicalExpression' &&
    test.operator === '||' &&
    test.left?.type === 'UnaryExpression' &&
    test.left.operator === '!' &&
    test.right?.type === 'UnaryExpression' &&
    test.right.operator === '!' &&
    ((identifier(test.left.argument, configuration) &&
      identifier(test.right.argument, diagnostic)) ||
      (identifier(test.left.argument, diagnostic) &&
        identifier(test.right.argument, configuration)))
  const skippedTest =
    !firstRequestGate && skipped?.test?.type === 'SequenceExpression'
      ? skipped.test.expressions.at(-1)
      : skipped?.test
  const gateExpressions =
    !firstRequestGate && skipped?.test?.type === 'SequenceExpression'
      ? skipped.test.expressions.slice(0, -1)
      : firstRequestGate
      ? [firstRequestGate]
      : []
  const validGate = firstRequestGate
    ? firstRequestGate.type === 'IfStatement' &&
      !firstRequestGate.alternate &&
      firstRequestGate.consequent?.type === 'EmptyStatement'
    : skipped?.test?.type === 'SequenceExpression' && skipped.test.expressions.length >= 2
  const skippedCheck =
    skipped?.type === 'IfStatement' &&
    !skipped.alternate &&
    isSkippedTest(skippedTest) &&
    skipped.consequent?.type === 'ReturnStatement' &&
    forwards(skipped.consequent.argument)
  if (
    !validGate ||
    !skippedCheck ||
    declaration(metadata)?.init?.type !== 'ArrowFunctionExpression'
  ) {
    return false
  }
  const directSendCalls = []
  const nestedSendCalls = []
  visit(
    fn.body,
    (node) => {
      if (node.type === 'CallExpression' && identifier(node.callee, send))
        directSendCalls.push(node)
    },
    false,
  )
  for (const statement of fn.body.body) {
    visit(
      statement,
      (node) => {
        if (
          node !== statement &&
          (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
        ) {
          const shadowed = new Set(node.params.map((parameter) => parameter.name))
          if (!shadowed.has(send)) {
            visit(node.body, (inner) => {
              if (inner.type === 'CallExpression' && identifier(inner.callee, send)) {
                nestedSendCalls.push(inner)
              }
            })
          }
        }
      },
      true,
    )
  }
  const assignment = attempt?.block?.body?.[0]?.expression
  const stable = new Set([url, options, send, configuration, diagnostic, response])
  const shadows = new Set(gate.params.map((parameter) => parameter.name))
  const gateProtected = new Set([
    ...[url, options, send].filter((name) => !shadows.has(name)),
    gate.params[1].name,
    gate.params[2].name,
  ])
  return (
    ownsFactoryFunction(factory.body, moduleSource, source) &&
    !hasInvalidNetworkCalls(factory.body) &&
    directSendCalls.length === 2 &&
    nestedSendCalls.length === 0 &&
    !mutates(fn.body, stable, assignment, false) &&
    gateExpressions.every((entry) => hasCompatibleFirstRequestGate(entry, stable, send)) &&
    !mutatesScoped(metadata, stable) &&
    !mutatesScoped(settled, stable) &&
    !mutatesScoped(gate.body, gateProtected) &&
    checkAttemptAndSettled(
      attempt,
      settled,
      response,
      send,
      (node) => member(node, diagnostic, 'url'),
      options,
      [...stable],
    ) &&
    !mutatesScoped(attempt.handler.body, new Set([...stable, attempt.handler.param.name]))
  )
}

// The October 31 frontend delegates tracking to a diagnostics helper. Its
// decorated branch is restricted to the site's /ces/v1/rgstr telemetry URL;
// other requests return the supplied fetch(url, options) directly. Recognize
// that branch boundary and the single attempt, rather than accepting any helper
// merely because the caller passes fetch as an argument.
export function hasCompatibleChatgptWebFetchDelegate(source, moduleSource, routes = []) {
  if (hasCompatibleChatgptWebSplitFetchDelegate(source, moduleSource, routes)) return true
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
    !isSimpleSetup(setup) ||
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
  if (
    gate.body.body.length !== 1 ||
    guard.type !== 'TryStatement' ||
    guard.finalizer ||
    guard.handler?.body?.body?.length !== 1 ||
    !isEmptyReturn(guard.handler.body.body[0]) ||
    guarded?.[0]?.type !== 'IfStatement' ||
    guarded[0].alternate ||
    !isEmptyReturn(guarded[0].consequent) ||
    parsed?.id?.type !== 'Identifier' ||
    parsed.init?.arguments?.length !== 1 ||
    !identifier(parsed.init.arguments[0], gate.params[1].name) ||
    routeGuard?.type !== 'IfStatement' ||
    routeGuard.alternate ||
    !isEmptyReturn(routeGuard.consequent) ||
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
    !isUndefinedExpression(result.alternate) ||
    route.length !== 4 ||
    !route.some((term) => equalProperty(term, parsedUrl.id.name, 'pathname', '/ces/v1/rgstr')) ||
    !hasSameOriginCredentialsCheck(route, parsedUrl.id.name)
  )
    return false
  const calls = []
  visit(fn.body, (node) => {
    if (node.type === 'CallExpression' && identifier(node.callee, send)) calls.push(node)
  })
  const assignment = attempt.block?.body?.[0]?.expression
  const stable = new Set([url, options, send, configuration, diagnostic, response])
  const shadows = gate.params.map((parameter) => parameter.name)
  return (
    ownsFactoryFunction(factory.body, moduleSource, source) &&
    !hasInvalidNetworkCalls(factory.body) &&
    !mutates(fn.body, stable, assignment) &&
    !mutates(
      gate.body,
      new Set([
        ...[url, options, send].filter((name) => !shadows.includes(name)),
        gate.params[1].name,
        gate.params[2].name,
      ]),
    ) &&
    calls.length === 3 &&
    checkAttemptAndSettled(
      attempt,
      settled,
      response,
      send,
      (node) => member(node, diagnostic, 'url'),
      options,
      [attempt.handler?.param?.name],
    )
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
      ['FunctionDeclaration', 'FunctionExpression'].includes(node.type) &&
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
    const delegates = importedFunctions(dependency, modules, (delegate) => {
      const routes = importedFunctions(delegate, modules, (routeModule) =>
        Object.entries(routeModule.functions || {}).filter(([, source]) =>
          hasCompatibleChatgptWebTelemetryRoute(source, routeModule.source),
        ),
      )
      return Object.entries(delegate.functions || {})
        .filter(([, source]) =>
          hasCompatibleChatgptWebFetchDelegate(source, delegate.source, routes),
        )
        .map(([name, source]) => [name, source, routes])
    })
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
