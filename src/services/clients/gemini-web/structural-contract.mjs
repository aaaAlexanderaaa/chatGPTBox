import { parse } from 'acorn'
import sha3 from 'js-sha3'
import {
  GEMINI_WEB_MODEL_DESCRIPTION,
  GEMINI_WEB_THINKING_LEVEL,
} from '../../../config/gemini-web.mjs'
import { codeSymbol, visitCode } from './code-equivalence.mjs'

// Static structural discovery and core-invariant verification for Gemini Web's
// public core compilation units (runtime m=_b and app m=vLefie). Never executes
// or evaluates website code. Any missing, ambiguous, or unsafe anchor refuses.
const MAX_BYTES = 8 * 1024 * 1024
const IDENT = /^[A-Za-z_$][\w$]*$/
const SAFE_KEY = (name) =>
  typeof name === 'string' &&
  IDENT.test(name) &&
  !['__proto__', 'prototype', 'constructor'].includes(name)

function uniqueRegex(source, regex, group = 1) {
  const hits = new Set()
  for (const match of source.matchAll(regex)) {
    const value = match[group]
    if (value) hits.add(value)
  }
  return hits.size === 1 ? [...hits][0] : null
}

function uniqueMatchObject(source, regex) {
  const hits = [...source.matchAll(regex)]
  return hits.length === 1 ? hits[0] : null
}

function assertNoDynamicCode(astNode) {
  let clean = true
  visitCode(astNode, (node) => {
    if (!clean) return
    if (
      node.type === 'WithStatement' ||
      node.type === 'ImportExpression' ||
      (node.type === 'CallExpression' && node.callee?.name === 'eval') ||
      (node.type === 'NewExpression' && node.callee?.name === 'Function')
    )
      clean = false
  })
  return clean
}

function hasDirectNetworkCall(astNode) {
  let found = false
  visitCode(astNode, (node) => {
    if (found) return
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === 'fetch'
    )
      found = true
    if (
      node.type === 'NewExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === 'XMLHttpRequest'
    )
      found = true
  })
  return found
}

function detectDeferredHelpers(parsed) {
  const stubs = new Map()
  const regs = new Map()
  for (const { source, ast } of parsed) {
    visitCode(ast, (node) => {
      if (node.type !== 'AssignmentExpression') return
      const name = codeSymbol(node.left)
      if (!name || !/^_\.[A-Za-z_$][\w$]*$/.test(name) || node.right.type !== 'FunctionExpression')
        return
      const text = source.slice(node.right.start, node.right.end)
      const stubMatch = text.match(
        /^function\(([A-Za-z_$][\w$]*)\)\{return function\(\)\{return ([A-Za-z_$][\w$]*)\[\1\]\.apply\(this,arguments\)\}\}$/,
      )
      if (stubMatch) stubs.set(name, stubMatch[2])
      const regMatch = text.match(
        /^function\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{return ([A-Za-z_$][\w$]*)\[\1\]=\2\}$/,
      )
      if (regMatch) regs.set(name, regMatch[3])
    })
  }
  const pairs = []
  for (const [stub, stubArr] of stubs.entries()) {
    for (const [reg, regArr] of regs.entries()) {
      if (stubArr === regArr) pairs.push({ stub, reg })
    }
  }
  if (pairs.length === 1) {
    return { stubCallees: [pairs[0].stub], regCallees: [pairs[0].reg] }
  }
  return { stubCallees: ['_.ba', '_.ca'], regCallees: ['_.ca', '_.da'] }
}

function indexParsedUnits(parsed) {
  const functions = new Map()
  const localFunctions = new Map()
  const classes = new Map()
  const deferred = new Map()
  const protoStubs = new Map()
  const { stubCallees, regCallees } = detectDeferredHelpers(parsed)

  const add = (map, name, entry) => {
    if (!name) return
    if (!map.has(name)) map.set(name, [])
    const list = map.get(name)
    if (!list.some((item) => item.source === entry.source && item.start === entry.start))
      list.push(entry)
  }

  for (const { source, ast } of parsed) {
    const protoAlias = new Map()
    visitCode(ast, (node) => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
        if (/Function/.test(node.init.type)) {
          add(localFunctions, node.id.name, {
            node: node.init,
            start: node.init.start,
            end: node.init.end,
            source,
          })
        }
      }
      if (node.type === 'FunctionDeclaration' && node.id?.name) {
        add(localFunctions, node.id.name, {
          node,
          start: node.start,
          end: node.end,
          source,
        })
      }
      if (node.type !== 'AssignmentExpression') return
      let name = codeSymbol(node.left)
      const right = codeSymbol(node.right)
      if (name && /^_\.[A-Za-z_$][\w$]*$/.test(name)) {
        if (right && /^_\.[A-Za-z_$][\w$]*\.prototype$/.test(right)) {
          protoAlias.set(name, right.slice(0, -10))
        } else {
          protoAlias.delete(name)
        }
      }
      if (name) {
        const aliasMatch = name.match(/^(_\.[A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
        if (aliasMatch && protoAlias.has(aliasMatch[1])) {
          name = `${protoAlias.get(aliasMatch[1])}.${aliasMatch[2]}`
        } else {
          const directProto = name.match(/^(_\.[A-Za-z_$][\w$]*)\.prototype\.([A-Za-z_$][\w$]*)$/)
          if (directProto) name = `${directProto[1]}.${directProto[2]}`
        }
      }
      const remember = (key, value) => {
        if (!value) return
        const entry = { node: value, start: value.start, end: value.end, source }
        if (/Function|Class/.test(value.type)) add(functions, key, entry)
        if (value.type === 'ClassExpression') {
          add(classes, key, entry)
          for (const method of value.body.body) {
            if (method.type === 'MethodDefinition' && !method.computed && method.key?.name) {
              add(functions, `${key}.${method.key.name}`, {
                node: method,
                start: method.start,
                end: method.end,
                source,
              })
            }
          }
        }
      }
      remember(name, node.right)
      if (node.left.type === 'Identifier' && /Function/.test(node.right.type)) {
        add(localFunctions, node.left.name, {
          node: node.right,
          start: node.right.start,
          end: node.right.end,
          source,
        })
      }
      if (node.right.type === 'CallExpression') {
        const callee = codeSymbol(node.right.callee)
        if (
          regCallees.includes(callee) &&
          node.right.arguments.length === 2 &&
          typeof node.right.arguments[0]?.value === 'number' &&
          node.right.arguments[1]?.type === 'FunctionExpression'
        ) {
          const body = node.right.arguments[1]
          const entry = { node: body, start: body.start, end: body.end, source }
          add(deferred, node.right.arguments[0].value, entry)
          remember(name, body)
        } else if (
          stubCallees.includes(callee) &&
          node.right.arguments.length === 1 &&
          typeof node.right.arguments[0]?.value === 'number'
        ) {
          if (name) {
            const dot = name.lastIndexOf('.')
            if (dot > 0) {
              const owner = name.slice(0, dot)
              const method = name.slice(dot + 1)
              if (!protoStubs.has(owner)) protoStubs.set(owner, [])
              protoStubs.get(owner).push({ name, method, id: node.right.arguments[0].value })
            }
          }
        }
      }
    })
  }
  for (const stubs of protoStubs.values()) {
    for (const stub of stubs) {
      for (const body of deferred.get(stub.id) || []) add(functions, stub.name, body)
    }
  }
  return { functions, localFunctions, classes, deferred, protoStubs }
}

function getUniqueEntry(map, key) {
  const list = map.get(key) || []
  return list.length === 1 ? list[0] : null
}

function entryText(entry) {
  return entry.source.slice(entry.start, entry.end)
}

function unwrapClosureLines(text) {
  return text.replace(/([,;({[=:?&|!+\-*/<>.])\r?\n/g, '$1').replace(/\r?\n([,;)}\]=:?&|.])/g, '$1')
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function classMethods(index, classSymbol) {
  const methods = new Map()
  const cls = getUniqueEntry(index.classes, classSymbol)
  if (cls) {
    for (const member of cls.node.body.body) {
      if (
        member.type === 'MethodDefinition' &&
        !member.computed &&
        member.kind === 'method' &&
        member.key?.name
      ) {
        methods.set(member.key.name, {
          node: member,
          start: member.start,
          end: member.end,
          source: cls.source,
        })
      }
    }
  }
  for (const stub of index.protoStubs.get(classSymbol) || []) {
    const resolved = index.deferred.get(stub.id) || []
    if (resolved.length === 1) methods.set(stub.method, resolved[0])
  }
  return methods
}

function reachesServiceSendRequest(submitEntry, serviceField, localFunctions) {
  const queue = [{ entry: submitEntry, depth: 0 }]
  const seen = new Set()
  const targetCall = `.${serviceField}.sendRequest(`
  while (queue.length) {
    const { entry, depth } = queue.shift()
    const key = `${entry.start}:${entry.end}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!assertNoDynamicCode(entry.node) || hasDirectNetworkCall(entry.node)) return false
    const text = entryText(entry)
    if (text.includes(targetCall)) return true
    if (depth >= 8) continue
    const callees = new Set()
    visitCode(entry.node, (node) => {
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier')
        callees.add(node.callee.name)
    })
    for (const name of callees) {
      const target = getUniqueEntry(localFunctions, name)
      if (target) queue.push({ entry: target, depth: depth + 1 })
    }
  }
  return false
}

function parsePositiveInt(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function uniqueNodeType(text, regex) {
  return parsePositiveInt(uniqueRegex(text, regex, 1))
}

function discoverStructuredContentContract(index) {
  const requiredCases = [2, 4, 11, 12, 13, 14, 15, 16, 17, 20, 22, 24, 35, 39, 60, 84, 91]
  const dispatchers = []
  for (const list of index.localFunctions.values()) {
    if (list.length !== 1) continue
    const entry = list[0]
    let found = null
    visitCode(entry.node, (node) => {
      if (node.type !== 'SwitchStatement') return
      const caseMap = new Map()
      let defaultCase = null
      for (const item of node.cases) {
        if (item.test === null) defaultCase = item
        else if (item.test.type === 'Literal' && typeof item.test.value === 'number')
          caseMap.set(item.test.value, item)
      }
      if (defaultCase && requiredCases.every((num) => caseMap.has(num))) {
        found = { entry, caseMap, defaultCase }
      }
    })
    if (found) dispatchers.push(found)
  }
  if (dispatchers.length !== 1) return null
  const { entry: dispatcherEntry, caseMap, defaultCase } = dispatchers[0]
  if (!assertNoDynamicCode(dispatcherEntry.node)) return null

  const callNamesIn = (astNode) => {
    const names = new Set()
    visitCode(astNode, (node) => {
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier')
        names.add(node.callee.name)
    })
    return [...names]
  }
  const resolveLocal = (name) => {
    const matches = (index.localFunctions.get(name) || []).filter(
      (item) => item.source === dispatcherEntry.source,
    )
    if (matches.length !== 1 || !assertNoDynamicCode(matches[0].node)) return null
    return { name, entry: matches[0], text: unwrapClosureLines(entryText(matches[0])) }
  }

  const defaultCalls = callNamesIn(defaultCase)
  if (defaultCalls.length !== 1) return null
  const emptyConv = resolveLocal(defaultCalls[0])
  if (!emptyConv) return null
  const empty = uniqueNodeType(emptyConv.text, /return\{nodeType:(\d+)\}/g)
  if (!empty) return null

  const caseConverter = (num) => {
    const names = callNamesIn(caseMap.get(num)).filter((name) => name !== emptyConv.name)
    if (names.length !== 1) return null
    return resolveLocal(names[0])
  }

  const textConv = caseConverter(2)
  const codeConv = caseConverter(4)
  const tableConv = caseConverter(11)
  const ulConv = caseConverter(12)
  const olConv = caseConverter(13)
  const paraConv = caseConverter(14)
  const calloutConv = caseConverter(15)
  const cont16Conv = caseConverter(16)
  const cont17Conv = caseConverter(17)
  const brConv = caseConverter(20)
  const cont22Conv = caseConverter(22)
  const mathConv = caseConverter(35)
  const execCodeConv = caseConverter(39)
  const cont60Conv = caseConverter(60)
  const layoutDispatch = caseConverter(84)
  const defConv = caseConverter(91)
  if (
    !textConv ||
    !codeConv ||
    !tableConv ||
    !ulConv ||
    !olConv ||
    !paraConv ||
    !calloutConv ||
    !cont16Conv ||
    !cont17Conv ||
    !brConv ||
    !cont22Conv ||
    !mathConv ||
    !execCodeConv ||
    !cont60Conv ||
    !layoutDispatch ||
    !defConv
  )
    return null

  const text = uniqueNodeType(textConv.text, /\{nodeType:(\d+),text:[A-Za-z_$][\w$]*\.getText\(\)/g)
  const code = uniqueNodeType(
    codeConv.text,
    /\{nodeType:(\d+),code:[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(\),info:[A-Za-z_$][\w$]*\.getInfo\(\)\}/g,
  )
  const execCode =
    execCodeConv.text.includes('"code_reference"') &&
    execCodeConv.text.includes('"code_stdout"') &&
    execCodeConv.text.includes('"code_stderr"')
      ? uniqueNodeType(
          execCodeConv.text,
          /\{nodeType:(\d+),type:[A-Za-z_$][\w$]*,code:[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(\),language:[A-Za-z_$][\w$]*\.getLanguage\(\)/g,
        )
      : null
  const mathHit = uniqueMatchObject(
    mathConv.text,
    /\{nodeType:(\d+),([A-Za-z_$][\w$]*):_\.[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,1\)\}/g,
  )
  const math = mathHit ? parsePositiveInt(mathHit[1]) : null
  const mathField = mathHit?.[2] || null

  const hrCase = caseMap.get(24)
  const hrText = unwrapClosureLines(dispatcherEntry.source.slice(hrCase.start, hrCase.end))
  const hr = uniqueNodeType(hrText, /return\{nodeType:(\d+)\}/g)

  const lineBreak = !/\b(?:children|text|code|items|rows|entries):/.test(brConv.text)
    ? uniqueNodeType(brConv.text, /\{nodeType:(\d+)\}/g)
    : null
  const callout =
    text &&
    calloutConv.text.includes(`.nodeType!==${text}`) &&
    calloutConv.text.includes('children:')
      ? uniqueNodeType(calloutConv.text, /\{nodeType:(\d+),title:/g)
      : null
  const paragraph = uniqueNodeType(paraConv.text, /\{nodeType:(\d+),children:/g)
  const containers = [cont60Conv, cont16Conv, cont17Conv, cont22Conv].map((conv) =>
    uniqueNodeType(conv.text, /\{nodeType:(\d+),children:/g),
  )

  const layoutSubNames = callNamesIn(layoutDispatch.entry.node).filter(
    (name) => name !== emptyConv.name,
  )
  if (layoutSubNames.length !== 3) return null
  const layouts = []
  for (const name of layoutSubNames) {
    const sub = resolveLocal(name)
    if (!sub) return null
    const nt = uniqueNodeType(sub.text, /\{nodeType:(\d+),children:/g)
    if (!nt) return null
    layouts.push(nt)
  }

  const orderedList = uniqueNodeType(
    olConv.text,
    /\{nodeType:(\d+),[A-Za-z_$][\w$]*:[^}]*?,items:/g,
  )
  const unorderedList = uniqueNodeType(ulConv.text, /\{nodeType:(\d+),items:/g)
  const table =
    text && tableConv.text.includes(`nodeType)===${text}&&{caption:`)
      ? uniqueNodeType(tableConv.text, /\{nodeType:(\d+),rows:/g)
      : null
  const definitionList = defConv.text.includes('description:')
    ? uniqueNodeType(defConv.text, /\{nodeType:(\d+),entries:/g)
    : null
  const definitionTerm = text
    ? uniqueRegex(
        defConv.text,
        new RegExp(`nodeType\\)===${text}&&\\{([A-Za-z_$][\\w$]*):[A-Za-z_$][\\w$]*\\}`, 'g'),
      )
    : null

  const allTypes = [
    text,
    code,
    execCode,
    math,
    hr,
    lineBreak,
    empty,
    callout,
    paragraph,
    ...containers,
    ...layouts,
    orderedList,
    unorderedList,
    table,
    definitionList,
  ]
  if (
    !mathField ||
    !definitionTerm ||
    allTypes.some((item) => !Number.isSafeInteger(item) || item <= 0) ||
    new Set(allTypes).size !== allTypes.length
  )
    return null

  return {
    math: mathField,
    definitionTerm,
    nodeTypes: {
      text,
      code,
      execCode,
      math,
      hr,
      lineBreak,
      empty,
      callout,
      paragraph,
      containers: [...containers].sort((a, b) => a - b),
      layouts: [...layouts].sort((a, b) => a - b),
      orderedList,
      unorderedList,
      table,
      definitionList,
    },
  }
}

export async function discoverStructuralGeminiContract(sources, version, options = {}) {
  const fail = (reason) => {
    if (options.returnDetails) return { contract: null, reason }
    return null
  }
  if (!Array.isArray(sources) || !sources.length || sources.length > 4)
    return fail('Expected 1 to 4 public compilation units.')
  let totalBytes = 0
  for (const source of sources) {
    if (typeof source !== 'string') return fail('Invalid source unit.')
    totalBytes += new TextEncoder().encode(source).length
    if (totalBytes > MAX_BYTES) return fail('Public code exceeds the inspection limit.')
  }

  let parsed
  try {
    parsed = sources.map((source) => ({
      source,
      ast: parse(source, { ecmaVersion: 'latest' }),
    }))
  } catch (error) {
    return fail(`Failed to parse public compilation: ${error.message}`)
  }

  const index = indexParsedUnits(parsed)
  const combined = unwrapClosureLines(sources.join('\n'))

  // 1. Core component & service classes
  const viewMap = uniqueRegex(
    combined,
    /_\.([A-Za-z_$][\w$]*)\.set\(([A-Za-z_$][\w$]*)\[19\],\2\)/g,
  )
  const inputClass = uniqueRegex(
    combined,
    /_\.([A-Za-z_$][\w$]*)\.Xa=_\.[A-Za-z_$][\w$]*\(\{type:_\.\1,[A-Za-z_$][\w$]*:\[\["input-area-v2"\]\]/g,
  )
  const convSvcHit = uniqueMatchObject(
    combined,
    /_\.([A-Za-z_$][\w$]*)=new _\.[A-Za-z_$][\w$]*\("ConversationService",\{tb:"root",hb:\(\)=>\{_\.([A-Za-z_$][\w$]*)\(_\.[A-Za-z_$][\w$]*\);return _\.[A-Za-z_$][\w$]*\(_\.[A-Za-z_$][\w$]*\("CVUPx"\),!1\)\?_\.\2\(_\.([A-Za-z_$][\w$]*)\):_\.\2\(_\.([A-Za-z_$][\w$]*)\)\}\}\)/g,
  )
  const convSvcToken = convSvcHit?.[1] || null
  const injectFn = convSvcHit?.[2] || null
  const serviceClass = convSvcHit?.[4] || null

  const convApiHit = uniqueMatchObject(
    combined,
    /_\.([A-Za-z_$][\w$]*)=_\.[A-Za-z_$][\w$]*\("ConversationApi",_\.([A-Za-z_$][\w$]*),_\.[A-Za-z_$][\w$]*\)/g,
  )
  const convApiToken = convApiHit?.[1] || null
  const apiClass = convApiHit?.[2] || null

  if (
    !viewMap ||
    !inputClass ||
    !convSvcToken ||
    !injectFn ||
    !serviceClass ||
    !convApiToken ||
    !apiClass
  )
    return fail('Missing core Gemini class or token anchors.')

  const esc = (name) => name.replaceAll('$', '\\$')
  const inputCls = getUniqueEntry(index.classes, `_.${inputClass}`)
  const serviceCls = getUniqueEntry(index.classes, `_.${serviceClass}`)
  const apiCls = getUniqueEntry(index.classes, `_.${apiClass}`)
  if (!inputCls || !serviceCls || !apiCls)
    return fail('Core Gemini class definitions are missing or ambiguous.')

  const inputText = unwrapClosureLines(entryText(inputCls))
  const serviceText = unwrapClosureLines(entryText(serviceCls))

  // 2. Service class fields & prepareFunction
  const historyServiceField = uniqueRegex(
    serviceText,
    new RegExp(
      `this\\.([A-Za-z_$][\\w$]*)=_\\.${esc(injectFn)}\\(_\\.${esc(convApiToken)}\\)`,
      'g',
    ),
  )
  const sendEntry = getUniqueEntry(index.functions, `_.${serviceClass}.sendRequest`)
  if (!sendEntry) return fail('Service sendRequest method not found.')
  const sendText = unwrapClosureLines(entryText(sendEntry))
  const actions = uniqueRegex(
    sendText,
    /this\.([A-Za-z_$][\w$]*)\.pipe\(_\.[A-Za-z_$][\w$]*\(_\.[A-Za-z_$][\w$]*\),_\.[A-Za-z_$][\w$]*\(/g,
  )
  const prepareFunction = uniqueRegex(sendText, /return _\.([A-Za-z_$][\w$]*)\(this,c,d\)/g)
  const stateRowsHit = uniqueMatchObject(
    serviceText,
    /this\.([A-Za-z_$][\w$]*)=this\.store\.select\(_\.[A-Za-z_$][\w$]*\);this\.[A-Za-z_$][\w$]*=this\.\1\.pipe\(_\.[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)=>!![A-Za-z_$][\w$]*\(\2\.([A-Za-z_$][\w$]*)\)\)\)/g,
  )
  const state = stateRowsHit?.[1] || null
  const rows = stateRowsHit?.[3] || null

  if (!historyServiceField || !actions || !prepareFunction || !state || !rows)
    return fail('Missing Gemini ConversationService field anchors.')

  // 3. prepareFunction fields & invariants
  const prepareEntry = getUniqueEntry(index.functions, `_.${prepareFunction}`)
  if (!prepareEntry) return fail('Gemini prepareFunction definition is missing or ambiguous.')
  const prepareText = unwrapClosureLines(entryText(prepareEntry))
  const requestMode = uniqueRegex(
    prepareText,
    /,([A-Za-z_$][\w$]*):([A-Za-z_$][\w$]*)==null\?void 0:\2\.id[,}]/g,
  )
  const requestParent = uniqueRegex(
    prepareText,
    /,([A-Za-z_$][\w$]*):[A-Za-z_$][\w$]*\|\|"",parentResponseId:/g,
  )
  if (!requestMode || !requestParent)
    return fail('Missing requestMode or requestParent in prepareFunction.')

  // 4. ConversationApi history & attestation methods (handles both class methods and _.da deferred)
  const apiMethods = classMethods(index, `_.${apiClass}`)
  const listMatches = []
  const readMatches = []
  const attestMatches = []
  for (const [methodName, entry] of apiMethods.entries()) {
    const text = unwrapClosureLines(entryText(entry))
    if (
      text.includes('nextPageToken') &&
      text.includes('a.pinned') &&
      text.includes('a.conversationId') &&
      text.includes('.fetch(')
    ) {
      listMatches.push([methodName, entry, text])
    } else if (text.includes('this.requestSource') && text.includes('.fetch(')) {
      const helperName = uniqueRegex(text, /f=([A-Za-z_$][\w$]*)\(f,a,this\.[A-Za-z_$][\w$]*/g)
      if (helperName) readMatches.push([methodName, entry, text, helperName])
    } else {
      const m = text.match(
        /^function\(a\)\{return _\.([A-Za-z_$][\w$]*)\(this\.[A-Za-z_$][\w$]*,a\)\}$/,
      )
      if (m) {
        const target = getUniqueEntry(index.functions, `_.${m[1]}`)
        const targetText = target ? unwrapClosureLines(entryText(target)) : ''
        if (targetText.includes('botguardResponse:') && targetText.includes('botguardSalt:')) {
          attestMatches.push([m[1], target, targetText])
        }
      }
    }
  }
  if (listMatches.length !== 1 || readMatches.length !== 1 || attestMatches.length !== 1)
    return fail('ConversationApi list, read, or attestation anchor is missing or ambiguous.')

  const [listMethod, listEntry, listText] = listMatches[0]
  const exactFilter = uniqueRegex(
    listText,
    /\(new _\.[A-Za-z_$][\w$]*,a\.pinned\),a\.([A-Za-z_$][\w$]*)\)/g,
  )
  const itemsField = uniqueRegex(
    listText,
    /=>\(\{([A-Za-z_$][\w$]*):_\.[A-Za-z_$][\w$]*\([^)]+\)\.map\(/g,
  )

  const [readMethod, readEntry, , readHelperName] = readMatches[0]
  const readHelperEntry = getUniqueEntry(index.localFunctions, readHelperName)
  if (!readHelperEntry) return fail('ConversationApi read converter helper not found.')
  const rowsField = uniqueRegex(
    unwrapClosureLines(entryText(readHelperEntry)),
    /Object\.assign\(\{\},\{([A-Za-z_$][\w$]*):f,nextPageToken:/g,
  )

  const [attestationFunction, attestationEntry, attestationText] = attestMatches[0]
  if (!exactFilter || !itemsField || !rowsField)
    return fail('ConversationApi history field anchors are missing or ambiguous.')

  // 5. thinkingSetter
  const thinkingSetter = uniqueRegex(
    combined,
    /_\.([A-Za-z_$][\w$]*)=function\(a,b,c\)\{a\.[A-Za-z_$][\w$]*\(b\)&&a\.[A-Za-z_$][\w$]*\.pipe\(_\.[A-Za-z_$][\w$]*\(1\)\)\.subscribe\(d=>\{d\.length!==0&&\(d=a\.[A-Za-z_$][\w$]*\(d,b,c\)\)&&_\.[A-Za-z_$][\w$]*\(a,b,d\.routingVariantId\)\}\)\}/g,
  )
  const thinkingEntry = thinkingSetter
    ? getUniqueEntry(index.functions, `_.${thinkingSetter}`)
    : null
  if (!thinkingSetter || !thinkingEntry)
    return fail('Gemini thinkingSetter anchor is missing or ambiguous.')

  // 6. Input class fields & submit method
  const service = uniqueRegex(
    inputText,
    new RegExp(
      `this\\.([A-Za-z_$][\\w$]*)=_\\.${esc(injectFn)}\\(_\\.${esc(convSvcToken)}\\)`,
      'g',
    ),
  )
  const form = uniqueRegex(
    inputText,
    /this\.([A-Za-z_$][\w$]*)=new _\.[A-Za-z_$][\w$]*\("",\{[A-Za-z_$][\w$]*:!0\}\);this\.[A-Za-z_$][\w$]*=this\.\1\.[A-Za-z_$][\w$]*\.pipe\(/g,
  )
  const eligible = uniqueRegex(
    inputText,
    /this\.([A-Za-z_$][\w$]*)=_\.[A-Za-z_$][\w$]*\(_\.[A-Za-z_$][\w$]*\("Lz8rbb"\),!1\)/g,
  )
  const genPrepHit = uniqueMatchObject(
    inputText,
    /=>this\.([A-Za-z_$][\w$]*)\(\)\?"Stop response":this\.([A-Za-z_$][\w$]*)\(\)\?"Cancel send":"Send message"/g,
  )
  const generating = genPrepHit?.[1] || null
  const preparing = genPrepHit?.[2] || null

  // Extract disableInput signal name from _.InputClass.Xa inputs metadata and confirm disabled signal
  const inputMetaPos = combined.indexOf(`_.${inputClass}.Xa=`)
  const inputMetaText = inputMetaPos >= 0 ? combined.slice(inputMetaPos, inputMetaPos + 2500) : ''
  const disableInputProp = uniqueRegex(inputMetaText, /([A-Za-z_$][\w$]*):\[1,"disableInput"/g)
  let disabled = null
  if (disableInputProp && preparing) {
    disabled = uniqueRegex(
      inputText,
      new RegExp(
        `this\\.([A-Za-z_$][\\w$]*)=_\\.Y\\(\\(\\)=>this\\.${disableInputProp.replace(
          '$',
          '\\$',
        )}\\(\\)\\|\\|this\\.[A-Za-z_$][\\w$]*\\(\\)\\|\\|this\\.${preparing.replace(
          '$',
          '\\$',
        )}\\(\\)\\)`,
        'g',
      ),
    )
  }
  const disabledFromLog = uniqueRegex(
    combined,
    /isEditingDisabled=\$\{a\.([A-Za-z_$][\w$]*)\(\)\}/g,
  )
  if (disabled && disabledFromLog && disabled !== disabledFromLog)
    return fail('Input disabled signal conflicts with editing-disabled log anchor.')
  disabled = disabled || disabledFromLog

  const editing = uniqueRegex(
    inputText,
    /this\.([A-Za-z_$][\w$]*)=this\.Ca\.Aa\?_\.Z\(this\.Ca\.Ca\.pipe\(_\.[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)=>\2\.Ia\)\)/g,
  )
  const attachments = uniqueRegex(
    inputText,
    /this\.([A-Za-z_$][\w$]*)=_\.Y\(\(\)=>this\.[A-Za-z_$][\w$]*\(\)\.some\(([A-Za-z_$][\w$]*)=>!\(\2==null\?0:\2\.[A-Za-z_$][\w$]*\)\)\)/g,
  )
  const references = uniqueRegex(
    inputText,
    /this\.([A-Za-z_$][\w$]*)=_\.Y\(\(\)=>this\.[A-Za-z_$][\w$]*\(\)\|\|this\.[A-Za-z_$][\w$]*\(\)\.size>0\|\|this\.[A-Za-z_$][\w$]*\(\)/g,
  )
  const feature = uniqueRegex(inputText, /featureMode:this\.([A-Za-z_$][\w$]*)\(\)/g)

  if (
    !service ||
    !form ||
    !eligible ||
    !generating ||
    !preparing ||
    !disabled ||
    !editing ||
    !attachments ||
    !references ||
    !feature
  )
    return fail('Missing Gemini InputArea field anchors.')

  const inputMethods = classMethods(index, `_.${inputClass}`)
  const submitCandidates = []
  const editingGuard = `else if(!this.${editing}())if(this.${preparing}())`
  for (const [methodName, entry] of inputMethods.entries()) {
    const text = unwrapClosureLines(entryText(entry))
    if (text.includes(editingGuard) && text.includes(`this.${form}.value`)) {
      submitCandidates.push([methodName, entry, text])
    }
  }
  if (submitCandidates.length !== 1)
    return fail('Gemini InputArea submit handler is missing or ambiguous.')
  const [submit, submitEntry, submitText] = submitCandidates[0]

  const embedded = uniqueRegex(
    submitText,
    /if\(this\.Ga\.Ha\(_\.[A-Za-z_$][\w$]*\)&&!this\.([A-Za-z_$][\w$]*)&&a&&this\.[A-Za-z_$][\w$]*\(\)\)/g,
  )
  if (!embedded || !inputText.includes(`this.${embedded}=`))
    return fail('Missing InputArea embedded flag anchor.')

  // 7. NgRx action payload fields (dispatch, failure, metadata)
  const sendSym = uniqueRegex(
    combined,
    /_\.([A-Za-z_$][\w$]*)=_\.[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\("Send Request"\)/g,
  )
  const failSym = uniqueRegex(
    combined,
    /_\.([A-Za-z_$][\w$]*)=_\.[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\("Generate Response Failure"\)/g,
  )
  if (!sendSym || !failSym) return fail('Missing Gemini NgRx action creator anchors.')

  const dispatch = uniqueRegex(
    combined,
    new RegExp(
      `\\(0,_\\.${sendSym.replace(
        '$',
        '\\$',
      )}\\)\\(\\{request:c,([A-Za-z_$][\\w$]*):\\{[A-Za-z_$][\\w$]*:b,request:c`,
      'g',
    ),
  )
  const failCallHit = uniqueMatchObject(
    combined,
    new RegExp(
      `\\(0,_\\.${failSym.replace(
        '$',
        '\\$',
      )}\\)\\(\\{([A-Za-z_$][\\w$]*):Object\\.assign\\([\\s\\S]{0,280}?,([A-Za-z_$][\\w$]*):v\\}\\)`,
      'g',
    ),
  )
  const failure = failCallHit?.[1] || null
  const metadata = failCallHit?.[2] || null
  if (!dispatch || !failure || !metadata)
    return fail('Missing Gemini NgRx dispatch, failure, or metadata field anchors.')

  // 8. Structured content rendering fields (math, definitionTerm) and exact nodeType map
  const structuredContent = discoverStructuredContentContract(index)
  if (!structuredContent)
    return fail('Missing or ambiguous structured content nodeType or field anchors.')
  const { math, definitionTerm, nodeTypes } = structuredContent

  // 9. Validate every discovered identifier is syntactically safe
  const fields = {
    service,
    submit,
    form,
    eligible,
    generating,
    preparing,
    disabled,
    editing,
    attachments,
    references,
    embedded,
    feature,
    state,
    actions,
    rows,
    metadata,
    dispatch,
    failure,
    requestMode,
    requestParent,
    math,
    definitionTerm,
  }
  const history = {
    apiClass,
    serviceField: historyServiceField,
    list: listMethod,
    read: readMethod,
    itemsField,
    exactFilter,
    rowsField,
  }
  const allIdentifiers = [
    viewMap,
    inputClass,
    serviceClass,
    prepareFunction,
    attestationFunction,
    thinkingSetter,
    ...Object.values(history),
    ...Object.values(fields),
  ]
  if (allIdentifiers.some((name) => !SAFE_KEY(name)))
    return fail('Discovered identifier failed safety validation.')

  // 10. Core behavioral & security invariant verification on all 8 entry ASTs
  const coreEntries = {
    submit: submitEntry,
    send: sendEntry,
    prepare: prepareEntry,
    attestation: attestationEntry,
    thinking: thinkingEntry,
    historyClass: apiCls,
    list: listEntry,
    read: readEntry,
  }
  for (const [role, entry] of Object.entries(coreEntries)) {
    if (!assertNoDynamicCode(entry.node))
      return fail(`Dynamic code construct found in core ${role} function.`)
  }
  if (!assertNoDynamicCode(readHelperEntry.node))
    return fail('Dynamic code construct found in history read converter.')
  if (hasDirectNetworkCall(submitEntry.node))
    return fail('Input submit handler unexpectedly invokes direct network transport.')
  if (!reachesServiceSendRequest(submitEntry, service, index.localFunctions))
    return fail('Input submit handler does not reach native service.sendRequest.')
  if (
    !sendText.includes('clientTurnId') ||
    !sendText.includes('this.store.dispatch') ||
    !sendText.includes(`_.${prepareFunction}(this`)
  )
    return fail('Service sendRequest failed structural invariant checks.')
  if (
    !prepareText.includes('a.bardModeService.oa') ||
    !prepareText.includes('a.bardModeService.Ca') ||
    !prepareText.includes('clientTurnId') ||
    !prepareText.includes('conversationId') ||
    !prepareText.includes('textQuery') ||
    !prepareText.includes('parentResponseId') ||
    !prepareText.includes('thinkingLevel')
  )
    return fail('Prepare function failed model/thinking/request invariant checks.')
  if (!attestationText.includes('botguardResponse:') || !attestationText.includes('botguardSalt:'))
    return fail('Attestation function failed BotGuard invariant checks.')

  // 11. Compute exact SHA-256 hashes of all 8 core entry functions
  const hashes = {}
  for (const [role, entry] of Object.entries(coreEntries)) {
    hashes[role] = await sha256Hex(entryText(entry))
  }

  const contract = {
    version,
    viewMap,
    inputClass,
    serviceClass,
    prepareFunction,
    attestationFunction,
    thinkingSetter,
    dictationIndicator: 'native-button-label',
    history,
    fields,
    nodeTypes,
    hashes,
    modelDescription: options.modelDescription || GEMINI_WEB_MODEL_DESCRIPTION,
    thinkingLevel: options.thinkingLevel || GEMINI_WEB_THINKING_LEVEL,
  }
  return options.returnDetails ? { contract, reason: null } : contract
}

// Offline cohort & Closure identity memoizer audit helper (used by scripts/adapt-gemini-build.mjs).
export function auditReceiverCohort(sources) {
  const parsed = sources.map((source) => ({
    source,
    ast: parse(source, { ecmaVersion: 'latest' }),
  }))
  const unitSha3 = sources.map((source) => sha3.sha3_256(source)).sort()
  const bindings = new Map()
  const calls = new Set()
  const sourceOf = new WeakMap()
  const add = (map, key, value) => {
    if (!key || !value) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
  }
  for (const { ast, source } of parsed) {
    visitCode(ast, (node) => {
      if (
        ['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type)
      )
        sourceOf.set(node, source.slice(node.start, node.end))
      if (node.type === 'AssignmentExpression') add(bindings, codeSymbol(node.left), node.right)
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier')
        add(bindings, node.id.name, node.init)
      if (node.type === 'FunctionDeclaration') add(bindings, node.id?.name, node)
      const callee =
        node.type === 'CallExpression'
          ? node.callee
          : node.type === 'TaggedTemplateExpression'
          ? node.tag
          : null
      if (callee?.type === 'MemberExpression' && !callee.computed && callee.object?.name === '_')
        calls.add(codeSymbol(callee))
    })
  }

  const combined = sources.join('\n')
  const unbound = [...calls].filter((name) => !bindings.has(name)).sort()
  const deferredFeatures = []
  for (const name of unbound) {
    const short = name.slice(2)
    const pos = combined.indexOf(`_.${short}(`)
    const context = pos >= 0 ? combined.slice(Math.max(0, pos - 180), pos + 180) : ''
    let kind = 'unknown'
    if (context.includes('"cd9YRd"')) kind = 'document-library'
    else if (context.includes('"VhtLzb"') || context.includes('"BrwYT"')) kind = 'video-playback'
    else if (context.includes('"OBxpef"') || context.includes('window.wizbind'))
      kind = 'optional-wiz'
    deferredFeatures.push({ name, kind })
  }

  const jsonAlias = uniqueRegex(combined, /(_\.[a-z]{2})\.JSON\.parse\b/g)
  const staticAllows = jsonAlias ? [`${jsonAlias}.JSON.parse`, `${jsonAlias}.JSON.stringify`] : []

  let identityMemoizer = null
  for (const [name, nodes] of bindings.entries()) {
    if (nodes.length !== 1 || !sourceOf.has(nodes[0])) continue
    const src = sourceOf.get(nodes[0])
    if (!src.includes('a.apply(') || !src.includes('.get(') || !src.includes('.set(')) continue
    const code = { [name]: sha3.sha3_256(src) }
    let weakMapVar = null
    const refs = [...new Set([...src.matchAll(/(?:_\.)?[A-Za-z_$][\w$]+/g)].map((m) => m[0]))]
    for (const ref of refs) {
      if (ref === name) continue
      const rNodes = bindings.get(ref) || []
      if (rNodes.length !== 1) continue
      if (sourceOf.has(rNodes[0])) code[ref] = sha3.sha3_256(sourceOf.get(rNodes[0]))
      else if (
        rNodes[0].type === 'NewExpression' &&
        rNodes[0].callee?.name === 'WeakMap' &&
        !rNodes[0].arguments.length
      )
        weakMapVar = ref
    }
    if (weakMapVar && Object.keys(code).length >= 3) {
      identityMemoizer = { wrapper: name, weakMapVar, code }
      break
    }
  }

  return { unitSha3, unavailableExports: unbound, deferredFeatures, staticAllows, identityMemoizer }
}
