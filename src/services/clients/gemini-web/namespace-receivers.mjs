// Offline reference audit. _.method() implicitly passes the namespace as this;
// explicit namespace-escape checks alone cannot establish independent fields.
import sha3 from 'js-sha3'

const REVIEWED_COHORTS = [
  {
    unitSha3: [
      'b16b2ff87b84c69ed279288e9b7126f3019449b3c673187f2454f46d4d909535',
      'f116e55c408446cb0b216b9bd9b125ec5b2b2c7e482c0a1fa9d817e1afc8d1ce',
    ],
    unavailableExports: ['_.dYc', '_.Ywg', '_.VAa'],
    staticAllows: ['_.ja.JSON.parse', '_.ja.JSON.stringify'],
  },
  {
    unitSha3: [
      '8dd4a127fbb04f4f01792660b0ee5c004a98b3bea76d768d7d7d0648b5226627',
      'b93aeaeaed1ccf3b0311c3ef07302731717ea82a2bd689669b1c0e5f2d2ef88c',
    ],
    unavailableExports: ['_.iZc', '_.mzg', '_.VAa'],
    staticAllows: ['_.ja.JSON.parse', '_.ja.JSON.stringify'],
  },
  {
    unitSha3: [
      '4ce8f4c260d4706a882a50486ba7c5b4bf1132d1f9fcdc26f6600bb575252d05',
      'd2e2667f05b5050173f97cc837aac3ab07e1a02a2ed0f5b6b733c9b60fb8c436',
    ],
    unavailableExports: ['_.WZc', '_.mAg', '_.UAa'],
    staticAllows: ['_.ja.JSON.parse', '_.ja.JSON.stringify'],
  },
  {
    unitSha3: [
      '78dc798064b75a7f041516ca9fb842d01ca40815360819f53ea66d9c6b79fdc2',
      'd7276e5705acb680d1a002922549bd6a065a4e4118f957b6060ff3eb0a99a1a0',
    ],
    unavailableExports: ['_.XZc', '_.nAg', '_.UAa'],
    staticAllows: ['_.ja.JSON.parse', '_.ja.JSON.stringify'],
  },
  {
    unitSha3: [
      '31180cb4867a4276995754dab86d327b8155e8b5c8caa7ea7fee8a236cea8453',
      '57dcafb3c49a425ccbe6667d49974a9bcb9765284828197e7fa313471e72f9c6',
    ],
    unavailableExports: ['_.b_c', '_.FAg', '_.UAa'],
    staticAllows: ['_.ja.JSON.parse', '_.ja.JSON.stringify'],
  },
  {
    unitSha3: [
      'a46c5941630689a61886412e80e8f089cd035deacfce195eb1f943adf5601787',
      'baa54e749cb570ca3a143444f68201ed22ee9891637772c0f856cacc6e855628',
    ],
    unavailableExports: ['_.O4c', '_.kFg', '_.LAa'],
    staticAllows: ['_.ka.JSON.parse', '_.ka.JSON.stringify'],
  },
]

const IDENTITY_MEMOIZERS = [
  {
    wrapper: '_.$Sa',
    weakMapVar: 'ZSa',
    code: {
      '_.$Sa': '09e69cd0b5bb0c02d1f94bf0d83da64fa3cabcd0358cc63d218bfdb0bd8e144b',
      '_.lka': '01672a7675543a39bca532c790f6e916b9dd1f1eac5cfed746a7c8bd81326b44',
      '_.Be': 'f9c9c77112a63920725546553156d33a14bb892afdcb82c191e9a873511a8c4f',
    },
  },
  {
    wrapper: '_.jTa',
    weakMapVar: 'iTa',
    code: {
      '_.jTa': '63cfcb927548bd67d10744976d28bf8f21a68c1d46cb3b65b9a4edb095611300',
      hTa: 'b45d5175be515c7652d3c11230dc77532df3346bc0ad152ceb56fbf2da5ac1dc',
      '_.Fe': '81cf9859b299f4ce0218bc90ceae37a89f082bc31ccf3caa0de6dfef716bbef2',
      '_.gka': '01672a7675543a39bca532c790f6e916b9dd1f1eac5cfed746a7c8bd81326b44',
    },
  },
  {
    wrapper: '_.iTa',
    weakMapVar: 'hTa',
    code: {
      '_.iTa': '27e52ede0a9d6b5c58f3c8dd0f2a732c5bd56260967ac18c1af6ad3ffc426daa',
      gTa: 'b45d5175be515c7652d3c11230dc77532df3346bc0ad152ceb56fbf2da5ac1dc',
      '_.Ge': '31d303dd37797db8edadc09d75ce0ccd87a8aceed6dee3b6cc2156b34b331898',
      '_.hka': '01672a7675543a39bca532c790f6e916b9dd1f1eac5cfed746a7c8bd81326b44',
    },
  },
  {
    wrapper: '_.iTa',
    weakMapVar: 'hTa',
    code: {
      '_.iTa': '40921903ad815e605e2a201a159c36bccb8f79c18ed97a25b6d1298017eb8403',
      gTa: 'b45d5175be515c7652d3c11230dc77532df3346bc0ad152ceb56fbf2da5ac1dc',
      '_.Fe': '31d303dd37797db8edadc09d75ce0ccd87a8aceed6dee3b6cc2156b34b331898',
      '_.hka': '01672a7675543a39bca532c790f6e916b9dd1f1eac5cfed746a7c8bd81326b44',
    },
  },
  {
    wrapper: '_.hTa',
    weakMapVar: 'gTa',
    code: {
      '_.hTa': '8ac09aabe6343bc508a67883b57b606f301e3366107ccf24eda9905f4e87cbb5',
      fTa: 'b45d5175be515c7652d3c11230dc77532df3346bc0ad152ceb56fbf2da5ac1dc',
      '_.He': '47fddd5ce93d51326c3635d6da4d7f6335a1435c1e293a335352144f67c14af8',
      '_.cka': '01672a7675543a39bca532c790f6e916b9dd1f1eac5cfed746a7c8bd81326b44',
    },
  },
]

export function verifyNamespaceReceivers(parsed, nativeCalls, { visitCode, codeSymbol }) {
  const bindings = new Map(),
    lazy = new Map(),
    calls = new Set(nativeCalls.map((name) => `_.${name}`))
  const safe = Symbol('receiver-independent')
  // Only these exact inspected compositions have three unloaded entrypoints:
  // document-library routing, video playback and optional wiz initialization.
  // They remain unavailable under the automatic document proof.
  const actualSha3 = JSON.stringify(parsed.map(({ source }) => sha3.sha3_256(source)).sort())
  const reviewedCohort = REVIEWED_COHORTS.find(
    (entry) => JSON.stringify(entry.unitSha3) === actualSha3,
  )
  const sourceOf = new WeakMap()
  const add = (map, name, value) => {
    if (!name || !value) return
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(value)
  }
  for (const { ast, source } of parsed)
    visitCode(ast, (node, parent) => {
      if (
        ['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type)
      )
        sourceOf.set(node, source.slice(node.start, node.end))
      if (node.type === 'AssignmentExpression') add(bindings, codeSymbol(node.left), node.right)
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier')
        add(bindings, node.id.name, node.init)
      if (node.type === 'FunctionDeclaration') add(bindings, node.id?.name, node)
      if (
        node.type === 'ClassExpression' &&
        ['AssignmentExpression', 'VariableDeclarator'].includes(parent?.type)
      ) {
        const name = codeSymbol(parent.left || parent.id)
        for (const method of node.body.body)
          if (method.type === 'MethodDefinition' && !method.computed)
            add(
              bindings,
              `${name}${method.static ? '' : '.prototype'}.${method.key.name}`,
              method.value,
            )
      }
      if (
        node.type === 'CallExpression' &&
        ['_.ca', '_.da'].includes(codeSymbol(node.callee)) &&
        node.arguments.length === 2 &&
        typeof node.arguments[0]?.value === 'number' &&
        node.arguments[1]?.type === 'FunctionExpression'
      )
        add(lazy, node.arguments[0].value, node.arguments[1])
      const callee =
        node.type === 'CallExpression'
          ? node.callee
          : node.type === 'TaggedTemplateExpression'
          ? node.tag
          : null
      if (callee?.type === 'MemberExpression' && !callee.computed && callee.object?.name === '_')
        calls.add(codeSymbol(callee))
    })
  // Inspected Closure identity memoizer: the receiver is only a WeakMap key
  // and is forwarded to the supplied callback. The cache dispatcher never
  // reads receiver properties; callback independence is still checked below.
  // Pin all receiver-handling code. This is not a generic memoizer heuristic.
  const identityMemoizer = IDENTITY_MEMOIZERS.find(
    (entry) =>
      Object.entries(entry.code).every(([name, hash]) => {
        const nodes = bindings.get(name) || []
        return (
          nodes.length === 1 &&
          sourceOf.has(nodes[0]) &&
          sha3.sha3_256(sourceOf.get(nodes[0])) === hash
        )
      }) &&
      !bindings.has('WeakMap') &&
      (bindings.get(entry.weakMapVar) || []).length === 1 &&
      bindings.get(entry.weakMapVar)[0].type === 'NewExpression' &&
      bindings.get(entry.weakMapVar)[0].callee?.name === 'WeakMap' &&
      !bindings.get(entry.weakMapVar)[0].arguments.length,
  )
  const walkBody = (fn, visitor, descendArrows = true) => {
    function walk(node, parent = null) {
      if (!node?.type) return
      if (
        node !== fn &&
        [
          'FunctionExpression',
          'FunctionDeclaration',
          'ClassExpression',
          'ClassDeclaration',
        ].includes(node.type)
      )
        return
      if (node !== fn && node.type === 'ArrowFunctionExpression' && !descendArrows) return
      visitor(node, parent)
      for (const [key, value] of Object.entries(node)) {
        if (['start', 'end', 'loc', 'range', 'raw'].includes(key)) continue
        if (Array.isArray(value)) value.forEach((child) => walk(child, node))
        else if (value && typeof value === 'object') walk(value, node)
      }
    }
    walk(fn)
  }
  function addMutations(fn, scope) {
    const mutated = new Set(scope.mutated || [])
    // A captured callback that can be replaced or have .apply overwritten is
    // not an established receiver-ignoring delegate.
    visitCode(fn.body, (node) => {
      const left =
        node.type === 'AssignmentExpression'
          ? node.left
          : node.type === 'UpdateExpression'
          ? node.argument
          : null
      if (left?.type === 'Identifier') mutated.add(left.name)
      if (left?.type === 'MemberExpression' && left.object?.type === 'Identifier')
        mutated.add(left.object.name)
    })
    scope.mutated = mutated
  }
  function resolve(node, locals = new Map(), seen = new Set(), depth = 0) {
    if (node === safe || node?.callable) return [node]
    if (!node || depth > 16) return []
    if (['FunctionExpression', 'FunctionDeclaration'].includes(node.type))
      return [{ callable: true, node, scope: locals }]
    if (node.type === 'ArrowFunctionExpression')
      return [{ callable: true, arrow: true, node, scope: locals }]
    if (['ClassExpression', 'ClassDeclaration'].includes(node.type))
      return [{ callable: true, class: true, node, scope: locals }]
    if (node.type === 'ConditionalExpression')
      return [
        ...resolve(node.consequent, locals, seen, depth + 1),
        ...resolve(node.alternate, locals, seen, depth + 1),
      ]
    if (node.type === 'LogicalExpression')
      return [
        ...resolve(node.left, locals, seen, depth + 1),
        ...resolve(node.right, locals, seen, depth + 1),
      ]
    const name = codeSymbol(node)
    if (name) {
      if (reviewedCohort?.staticAllows.includes(name)) return [safe]
      if (seen.has(name)) return []
      const next = new Set([...seen, name])
      return (locals.get(name) || bindings.get(name) || []).flatMap((value) =>
        resolve(value, locals, next, depth + 1),
      )
    }
    if (node.type !== 'CallExpression') return []
    const callee = codeSymbol(node.callee)
    if (['_.ca', '_.da'].includes(callee) && node.arguments.length === 2)
      return resolve(node.arguments[1], locals, seen, depth + 1)
    if (['_.ba', '_.ca'].includes(callee) && node.arguments.length === 1)
      return (lazy.get(node.arguments[0]?.value) || []).flatMap((value) =>
        resolve(value, locals, seen, depth + 1),
      )
    if (identityMemoizer && callee === identityMemoizer.wrapper)
      return resolve(node.arguments[0], locals, seen, depth + 1)
    if (node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'bind') {
      const target = node.callee.object
      const overrides = bindings.has(`${codeSymbol(target)}.bind`)
      const functions = resolve(target, locals, seen, depth + 1)
      if (
        !overrides &&
        functions.length &&
        functions.every(
          (value) =>
            value === safe ||
            !value.class ||
            !value.node.body.body.some((member) => member.static && member.key?.name === 'bind'),
        )
      )
        return [safe]
    }
    const factories = resolve(node.callee, locals, seen, depth + 1)
    const products = []
    for (const factory of factories) {
      if (factory === safe || factory.class) continue
      const fn = factory.node,
        scope = new Map(factory.scope)
      fn.params.forEach((parameter, index) => {
        if (parameter.type === 'Identifier')
          scope.set(parameter.name, resolve(node.arguments[index], locals, seen, depth + 1))
      })
      walkBody(
        fn,
        (child) => {
          if (child.type === 'VariableDeclarator' && child.id.type === 'Identifier' && child.init)
            scope.set(child.id.name, [child.init])
        },
        false,
      )
      if (fn.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement')
        products.push(...resolve(fn.body, scope, seen, depth + 1))
      addMutations(fn, scope)
      walkBody(
        fn,
        (child) => {
          if (child.type === 'ReturnStatement')
            products.push(...resolve(child.argument, scope, seen, depth + 1))
        },
        false,
      )
    }
    return products
  }
  function ignoresReceiver(value, seen = new Set()) {
    if (value === safe || value.arrow || value.class) return true
    const fn = value.node
    if (seen.has(fn)) return false
    const next = new Set([...seen, fn]),
      scope = new Map(value.scope)
    scope.mutated = new Set(value.scope.mutated || [])
    for (const parameter of fn.params)
      if (parameter.type === 'Identifier') scope.set(parameter.name, [])
    walkBody(
      fn,
      (child) => {
        if (child.type === 'VariableDeclarator' && child.id.type === 'Identifier' && child.init)
          scope.set(child.id.name, [child.init])
      },
      false,
    )
    addMutations(fn, scope)
    let safeReceiver = true
    walkBody(fn, (node, parent) => {
      if (node.type !== 'ThisExpression') return
      const callee = parent?.callee
      const forwarding =
        parent?.type === 'CallExpression' &&
        parent.arguments[0] === node &&
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        ['apply', 'call'].includes(callee.property?.name)
      if (!forwarding) {
        safeReceiver = false
        return
      }
      const target = callee.object
      if (target.type === 'Identifier' && scope.mutated.has(target.name)) {
        safeReceiver = false
        return
      }
      const delegates = resolve(target, scope)
      if (!delegates.length || delegates.some((delegate) => !ignoresReceiver(delegate, next)))
        safeReceiver = false
    })
    return safeReceiver
  }
  const unresolved = []
  const unavailableExports = []
  for (const name of calls) {
    const functions = resolve({ type: 'Identifier', name })
    if (!functions.length) {
      if (reviewedCohort?.unavailableExports.includes(name)) unavailableExports.push(name.slice(2))
      else unresolved.push(name)
    }
    if (functions.some((fn) => !ignoresReceiver(fn)))
      throw new Error(`Unconfirmed namespace this receiver: ${name}`)
  }
  if (unresolved.length)
    throw new Error(
      `Unconfirmed namespace call targets (${unresolved.length}): ${unresolved
        .slice(0, 30)
        .join(', ')}`,
    )
  return {
    verified: true,
    nativeCalls: [...nativeCalls],
    inspectedCalls: calls.size,
    unavailableExports: unavailableExports.sort(),
    requiresNoWizbind: !!unavailableExports.length,
  }
}
