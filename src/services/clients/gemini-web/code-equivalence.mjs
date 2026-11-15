import { parse, tokenizer } from 'acorn'
import sha3 from 'js-sha3'
import { verifyNamespaceReceivers } from './namespace-receivers.mjs'

// This is exact token equivalence under injective renaming in declared domains, not a
// similarity score. The bundled reference chooses every renameable occurrence.
// Candidates cannot enlarge that set. Entire compilation units are compared,
// including helpers, constants, guards, wire converters and module setup.
const MAX_BYTES = 8 * 1024 * 1024
const MAX_NAMES = 1500000
const ignored = new Set(['start', 'end', 'loc', 'range', 'raw'])

export function visitCode(node, fn, parent = null) {
  if (!node || typeof node !== 'object' || !node.type) return
  fn(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (ignored.has(key)) continue
    if (Array.isArray(value)) value.forEach((child) => visitCode(child, fn, node))
    else if (value && typeof value === 'object') visitCode(value, fn, node)
  }
}

export function codeSymbol(node) {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'MemberExpression' && !node.computed) {
    const base = codeSymbol(node.object)
    return base && node.property.type === 'Identifier' ? `${base}.${node.property.name}` : null
  }
  return null
}

function tokens(source, fn) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_BYTES)
    throw new Error('Gemini public code exceeds the inspection limit.')
  const input = tokenizer(source, { ecmaVersion: 'latest' })
  let names = 0,
    count = 0
  for (;;) {
    const token = input.getToken()
    if (token.type.label === 'eof') break
    const index = token.type.label === 'name' ? names++ : -1
    if (names > MAX_NAMES) throw new Error('Gemini public code exceeds the inspection limit.')
    fn(token, index)
    count++
  }
  return { names, tokens: count }
}

function update(hash, type, value) {
  const text = JSON.stringify(value, (_, item) =>
    typeof item === 'bigint' ? ['bigint', String(item)] : item,
  )
  hash.update(`${type.length}:${type}${text?.length || 0}:${text || ''};`)
}

function literalValue(source, token) {
  // Raw spelling matters for strict directives and tagged-template raw text.
  return ['string', 'regexp', 'template', 'invalidTemplate', 'num', 'bigint'].includes(
    token.type.label,
  )
    ? source.slice(token.start, token.end)
    : token.value
}

function parsedCode(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_BYTES)
    throw new Error('Gemini public code exceeds the inspection limit.')
  const inserted = new Set()
  const ast = parse(source, {
    ecmaVersion: 'latest',
    onInsertedSemicolon: (position) => inserted.add(position),
  })
  return { ast, inserted }
}

export function publicCodeShape(source, inserted = parsedCode(source).inserted) {
  const hash = sha3.sha3_256.create()
  const counts = tokens(source, (token) => {
    update(hash, token.type.label, token.type.label === 'name' ? null : literalValue(source, token))
    // Formatting is ignorable only when automatic semicolon insertion stays
    // unchanged. Otherwise return/newline could silently change the logic.
    if (inserted.has(token.end)) update(hash, 'inserted-semicolon', true)
  })
  return { ...counts, shape: hash.hex() }
}

function encodeMask(bits) {
  let text = ''
  for (let offset = 0; offset < bits.length; offset += 8192)
    text += String.fromCharCode(...bits.subarray(offset, offset + 8192))
  return btoa(text)
}

const domains = ['unused', 'namespace', 'fields', 'helpers']
const intrinsicKeys = ['__proto__', 'prototype', 'constructor']

function decodeMask(text, names) {
  if (typeof text !== 'string' || text.length > (MAX_NAMES * 4) / 3 + 4)
    throw new Error('Invalid Gemini reference mask.')
  const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
  if (bytes.length !== names || bytes.some((value) => value < 1 || value > 7 || value === 4))
    throw new Error('Invalid Gemini reference mask.')
  return bytes
}

function newState(protectedNames) {
  const state = {
    hash: sha3.sha3_256.create(),
    names: Array.from({ length: 4 }, () => new Map()),
    fixed: protectedNames.map((names) => new Set(names)),
  }
  for (const kind of [1, 2]) for (const name of intrinsicKeys) state.fixed[kind].add(name)
  return state
}

function canonical(source, mask, state) {
  return tokens(source, (token, index) => {
    const value = literalValue(source, token)
    if (index >= 0) {
      const kind = mask[index] & 3
      if (mask[index] & 4) {
        const names = state.names[kind]
        if (!names.has(value)) names.set(value, names.size)
        update(state.hash, `renamed-${kind}`, names.get(value))
      } else {
        state.fixed[kind].add(value)
        update(state.hash, `fixed-${kind}`, value)
      }
    } else update(state.hash, token.type.label, value)
  })
}

function finish(state) {
  for (let kind = 1; kind < 4; kind++)
    if ([...state.names[kind].keys()].some((name) => state.fixed[kind].has(name)))
      throw new Error('A Gemini rename collides with a fixed identifier in its naming domain.')
  return { digest: state.hash.hex(), symbols: state.names.map((names) => [...names.keys()]) }
}

// References are created offline. Namespace keys, instance keys and lexical
// helpers have distinct binding domains: _.AM must not be confused with the
// unrelated timezone string "AM" or an instance's .AM field.
export function createCodeReference(sources, instanceKeys = [], nativeCalls = []) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 4)
    throw new Error('A complete Gemini compilation is required.')
  const parsed = sources.map((source) => ({ source, ...parsedCode(source) }))
  const receiverContract = verifyNamespaceReceivers(parsed, nativeCalls, { visitCode, codeSymbol })
  const exports = new Set(),
    fields = new Set(instanceKeys)
  const protectedNames = Array.from({ length: 4 }, () => new Set())
  for (const name of ['aa', 'ba', 'ca']) protectedNames[1].add(name)
  for (const kind of [1, 2]) for (const name of intrinsicKeys) protectedNames[kind].add(name)
  for (const unit of parsed) {
    const scopes = []
    visitCode(unit.ast, (node) => {
      const fn = node.callee?.object
      if (
        node.type !== 'CallExpression' ||
        node.callee?.property?.name !== 'call' ||
        fn?.type !== 'FunctionExpression' ||
        fn.params.length !== 1 ||
        fn.params[0]?.name !== '_' ||
        node.arguments[0]?.type !== 'ThisExpression' ||
        node.arguments[1]?.object?.type !== 'ThisExpression' ||
        node.arguments[1]?.property?.name !== 'default_BardChatUi'
      )
        return
      const names = new Set()
      function declarations(child) {
        if (!child || typeof child !== 'object' || !child.type) return
        if (/Function|Class/.test(child.type)) return
        if (child.type === 'VariableDeclaration' && child.kind !== 'var') return
        if (
          child.type === 'VariableDeclarator' &&
          child.id.type === 'Identifier' &&
          child.id.name.length > 2 &&
          child.id.name !== 'window'
        )
          names.add(child.id.name)
        for (const [key, value] of Object.entries(child)) {
          if (ignored.has(key)) continue
          if (Array.isArray(value)) value.forEach(declarations)
          else if (value && typeof value === 'object') declarations(value)
        }
      }
      declarations(fn.body)
      scopes.push({ start: fn.body.start, end: fn.body.end, names })
    })
    const inScope = (node) =>
      scopes.some((scope) => node.start >= scope.start && node.end <= scope.end)
    unit.scopes = scopes
    visitCode(unit.ast, (node, parent) => {
      if (
        node.type === 'WithStatement' ||
        node.type === 'ImportExpression' ||
        (node.type === 'CallExpression' && node.callee?.name === 'eval') ||
        (node.type === 'NewExpression' && node.callee?.name === 'Function')
      )
        throw new Error('Dynamic code cannot establish a Gemini renaming reference.')
      // A namespace that escapes to reflection or dynamic indexing cannot be
      // proven renameable by this deliberately limited static contract.
      if (node.type === 'Identifier' && node.name === '_' && inScope(node)) {
        const staticReceiver =
          parent?.type === 'MemberExpression' && parent.object === node && !parent.computed
        const propertyKey =
          ['MemberExpression', 'Property', 'MethodDefinition', 'PropertyDefinition'].includes(
            parent?.type,
          ) &&
          (parent.property === node || parent.key === node) &&
          !parent.computed &&
          !parent.shorthand
        if (!staticReceiver && !propertyKey)
          throw new Error(`Unconfirmed Gemini namespace escape at ${node.start}.`)
      }
      if (
        node.type === 'AssignmentExpression' &&
        node.left?.object?.name === '_' &&
        !node.left.computed &&
        inScope(node)
      )
        exports.add(node.left.property.name)
      if (
        node.type === 'Literal' &&
        typeof node.value === 'string' &&
        /^[A-Za-z_$][\w$]{0,127}$/.test(node.value)
      ) {
        protectedNames[2].add(node.value)
        protectedNames[3].add(node.value)
      }
      if (node.type === 'Property' && node.shorthand && node.key?.type === 'Identifier') {
        protectedNames[2].add(node.key.name)
        protectedNames[3].add(node.key.name)
      }
      if (
        ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(node.type) &&
        node.label
      )
        protectedNames[3].add(node.label.name)
    })
  }
  const positions = parsed.map((unit) => {
    const result = new Map()
    const inScope = (node) =>
      unit.scopes.some((scope) => node.start >= scope.start && node.end <= scope.end)
    visitCode(unit.ast, (node) => {
      if (node.type === 'Identifier') {
        const helper = unit.scopes.some(
          (scope) =>
            node.start >= scope.start && node.end <= scope.end && scope.names.has(node.name),
        )
        if (!result.has(node.start)) result.set(node.start, { kind: 3, rename: helper })
      }
      if (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier'
      ) {
        const kind = node.object?.name === '_' && inScope(node) ? 1 : 2
        result.set(node.property.start, {
          kind,
          rename: kind === 1 ? exports.has(node.property.name) : fields.has(node.property.name),
        })
      }
      if (
        ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(node.type) &&
        !node.computed &&
        node.key?.type === 'Identifier'
      )
        result.set(
          node.key.start,
          node.shorthand
            ? { kind: 3, rename: false }
            : { kind: 2, rename: fields.has(node.key.name) },
        )
      if (
        ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(node.type) &&
        node.label
      )
        result.set(node.label.start, { kind: 3, rename: false })
    })
    return result
  })
  const fixed = protectedNames.map((names) => new Set(names))
  parsed.forEach(({ source }, i) =>
    tokens(source, (token, index) => {
      if (index < 0) return
      const position = positions[i].get(token.start) || { kind: 3, rename: false }
      if (!position.rename) fixed[position.kind].add(token.value)
    }),
  )
  const protectedRecord = protectedNames.map((names) => [...names].sort())
  const state = newState(protectedRecord)
  const units = parsed.map(({ source, inserted }, i) => {
    const shape = publicCodeShape(source, inserted)
    const mask = new Uint8Array(shape.names)
    tokens(source, (token, index) => {
      if (index < 0) return
      const position = positions[i].get(token.start) || { kind: 3, rename: false }
      mask[index] =
        position.kind | (position.rename && !fixed[position.kind].has(token.value) ? 4 : 0)
    })
    update(state.hash, 'unit', i)
    canonical(source, mask, state)
    return { ...shape, mask: encodeMask(mask) }
  })
  return { format: 4, receiverContract, units, protected: protectedRecord, ...finish(state) }
}

export function matchCodeReference(sources, reference) {
  try {
    if (
      reference?.format !== 4 ||
      reference.receiverContract?.verified !== true ||
      sources.length !== reference.units.length ||
      sources.length > 4
    )
      return null
    const shapes = sources.map((source) => publicCodeShape(source))
    const used = new Set(),
      ordered = []
    for (const unit of reference.units) {
      const matches = shapes.flatMap((shape, index) =>
        shape.shape === unit.shape && shape.names === unit.names && shape.tokens === unit.tokens
          ? [index]
          : [],
      )
      if (matches.length !== 1 || used.has(matches[0])) return null
      used.add(matches[0])
      ordered.push(sources[matches[0]])
    }
    const state = newState(reference.protected)
    ordered.forEach((source, i) => {
      update(state.hash, 'unit', i)
      canonical(source, decodeMask(reference.units[i].mask, reference.units[i].names), state)
    })
    const actual = finish(state)
    if (actual.digest !== reference.digest) return null
    const names = {}
    for (let kind = 1; kind < 4; kind++) {
      if (actual.symbols[kind].length !== reference.symbols[kind].length) return null
      names[domains[kind]] = new Map(
        reference.symbols[kind].map((name, i) => [name, actual.symbols[kind][i]]),
      )
    }
    return { ordered, names }
  } catch {
    return null
  }
}

// Offline regression helper only. It rewrites approved token occurrences, not
// same-spelled data/fields in a different domain. No website code is executed.
export function renameReferenceCode(
  sources,
  reference,
  choose = (kind, index) => `_$${kind}${index.toString(36)}`,
) {
  const names = Array.from({ length: 4 }, () => new Map())
  return sources.map((source, unit) => {
    const mask = decodeMask(reference.units[unit].mask, reference.units[unit].names)
    let result = '',
      previous = 0
    tokens(source, (token, index) => {
      if (index < 0 || !(mask[index] & 4)) return
      const kind = mask[index] & 3
      if (!names[kind].has(token.value))
        names[kind].set(token.value, choose(kind, names[kind].size))
      result += source.slice(previous, token.start) + names[kind].get(token.value)
      previous = token.end
    })
    return result + source.slice(previous)
  })
}

export async function extractNativeHashes(sources, profile) {
  const functions = new Map(),
    deferred = new Map(),
    stubs = []
  let alias = null
  const add = (map, name, node) => {
    if (!name) return
    if (!map.has(name)) map.set(name, [])
    if (!map.get(name).some((entry) => entry.source === node.source && entry.start === node.start))
      map.get(name).push(node)
  }
  for (const source of sources)
    visitCode(parse(source, { ecmaVersion: 'latest' }), (node) => {
      if (node.type !== 'AssignmentExpression') return
      let name = codeSymbol(node.left)
      const right = codeSymbol(node.right)
      if (name === '_.aa' && right?.endsWith('.prototype')) alias = right.slice(0, -10)
      if (name?.startsWith('_.aa.') && alias) name = alias + name.slice(4)
      const remember = (key, value) => {
        if (!value) return
        const entry = { start: value.start, end: value.end, source }
        if (/Function|Class/.test(value.type)) add(functions, key, entry)
        if (value.type === 'ClassExpression')
          for (const method of value.body.body) {
            if (method.type === 'MethodDefinition' && !method.computed)
              add(functions, `${key}.${method.key.name}`, {
                start: method.start,
                end: method.end,
                source,
              })
          }
      }
      remember(name, node.right)
      if (
        node.right.type === 'CallExpression' &&
        codeSymbol(node.right.callee) === '_.ca' &&
        node.right.arguments[1]?.type === 'FunctionExpression'
      ) {
        const body = node.right.arguments[1]
        add(deferred, node.right.arguments[0]?.value, { start: body.start, end: body.end, source })
        remember(name, body)
      }
      if (node.right.type === 'CallExpression' && codeSymbol(node.right.callee) === '_.ba')
        stubs.push({ name, id: node.right.arguments[0]?.value })
    })
  for (const stub of stubs)
    for (const body of deferred.get(stub.id) || []) add(functions, stub.name, body)
  const roles = {
    submit: `_.${profile.inputClass}.${profile.fields.submit}`,
    send: `_.${profile.serviceClass}.sendRequest`,
    prepare: `_.${profile.prepareFunction}`,
    attestation: `_.${profile.attestationFunction}`,
    thinking: `_.${profile.thinkingSetter}`,
    historyClass: `_.${profile.history.apiClass}`,
    list: `_.${profile.history.apiClass}.${profile.history.list}`,
    read: `_.${profile.history.apiClass}.${profile.history.read}`,
  }
  const hashes = {}
  for (const [role, symbol] of Object.entries(roles)) {
    const nodes = functions.get(symbol) || []
    if (nodes.length !== 1)
      throw new Error(`The Gemini ${role} definition is incomplete or ambiguous.`)
    const node = nodes[0]
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(node.source.slice(node.start, node.end)),
    )
    hashes[role] = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  return hashes
}
