import { parse } from 'acorn'
import { GENUI_NAMED_COMPONENTS, getGenuiComponent } from './genui-components.mjs'
import { GenuiError, genuiOwnValue as ownValue, recordGenuiError } from './genui-presentation.mjs'

export { recordGenuiError } from './genui-presentation.mjs'

export function createGenuiDiagnostics() {
  return {
    unsupportedComponents: [],
    unsupportedProperties: [],
    omittedLinks: 0,
    localFallbacks: 0,
  }
}

// Only bounded static expressions are interpreted. Generated functions, hooks,
// handlers and arbitrary calls are never executed.
export function decodeGenuiResult(dil, diagnostics = createGenuiDiagnostics()) {
  if (typeof dil?.code !== 'string' || dil.code.length > 500000)
    return { tree: null, reason: 'invalid-code', diagnostics }
  try {
    const program = parse(dil.code, { ecmaVersion: 'latest' })
    const render = program.body.find(
      (node) =>
        node.type === 'ExpressionStatement' &&
        node.expression.type === 'CallExpression' &&
        node.expression.callee.type === 'MemberExpression' &&
        node.expression.callee.object.name === 'DIL' &&
        node.expression.callee.property.name === 'render',
    )?.expression
    if (!render) throw new GenuiError('invalid-code')
    let count = 0,
      depth = 0
    const read = (node, scope = new Map()) => {
      if (++count > 10000 || ++depth > 80 || !node) throw new GenuiError('resource-limit')
      try {
        return expression(node, scope)
      } finally {
        depth -= 1
      }
    }
    const object = (node, scope, props = false) => {
      const result = Object.create(null)
      for (const prop of node.properties) {
        if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init')
          throw new GenuiError('unsupported-expression')
        const key = prop.key.name ?? prop.key.value
        if (['__proto__', 'prototype', 'constructor'].includes(String(key)))
          throw new GenuiError('unsupported-expression')
        if (props && /^on[A-Z]/.test(key)) {
          // Exporting the initial static view does not export interactions.
          continue
        }
        result[key] = read(prop.value, scope)
      }
      return result
    }
    const expression = (node, scope) => {
      if (node.type === 'Literal') {
        if (node.regex || typeof node.value === 'bigint')
          throw new GenuiError('unsupported-expression')
        return node.value
      }
      if (node.type === 'ArrayExpression') {
        if (node.elements.length > 512) throw new GenuiError('resource-limit')
        return node.elements.map((entry) => (entry ? read(entry, scope) : null))
      }
      if (node.type === 'ObjectExpression') return object(node, scope)
      if (node.type === 'MemberExpression') {
        if (
          node.object.name === '__dilConstants' &&
          node.computed &&
          node.property.type === 'Literal'
        )
          return ownValue(dil.constants, node.property.value) ?? null
        if (node.object.name === '__dil' && node.property.name === 'Fragment') return 'fragment'
        const key = node.computed ? read(node.property, scope) : node.property.name
        if (typeof key !== 'string' && typeof key !== 'number')
          throw new GenuiError('unsupported-expression')
        return ownValue(read(node.object, scope), key)
      }
      if (node.type === 'Identifier') {
        if (Object.prototype.hasOwnProperty.call(GENUI_NAMED_COMPONENTS, node.name))
          return GENUI_NAMED_COMPONENTS[node.name]
        if (scope.has(node.name)) return scope.get(node.name)
        if (node.name === 'undefined') return undefined
        if (/^[A-Z][A-Za-z0-9_$]*$/.test(node.name)) return node.name
      }
      if (node.type === 'ConditionalExpression')
        return read(node.test, scope) ? read(node.consequent, scope) : read(node.alternate, scope)
      if (node.type === 'LogicalExpression') {
        const left = read(node.left, scope)
        if (node.operator === '??') return left == null ? read(node.right, scope) : left
        if (node.operator === '&&') return left ? read(node.right, scope) : left
        if (node.operator === '||') return left || read(node.right, scope)
      }
      if (node.type === 'UnaryExpression' && node.operator === '!')
        return !read(node.argument, scope)
      if (node.type === 'TemplateLiteral') {
        let result = node.quasis[0].value.cooked
        for (let i = 0; i < node.expressions.length; i++) {
          const value = read(node.expressions[i], scope)
          if (value != null && !['string', 'number', 'boolean'].includes(typeof value))
            throw new GenuiError('unsupported-expression')
          result += String(value) + node.quasis[i + 1].value.cooked
        }
        return result
      }
      if (node.type === 'ArrowFunctionExpression') {
        if (node.async) throw new GenuiError('unsupported-expression')
        if (node.body.type !== 'BlockStatement') return read(node.body, scope)
        const local = new Map(scope)
        for (const entry of node.body.body) {
          if (entry.type === 'ReturnStatement') return read(entry.argument, local)
          if (entry.type !== 'VariableDeclaration' || entry.kind !== 'const')
            throw new GenuiError('unsupported-expression')
          for (const declaration of entry.declarations) {
            if (declaration.id.type !== 'Identifier') throw new GenuiError('unsupported-expression')
            // The usual wrapper hook is recognized as an immutable data binding.
            // Its implementation is never called.
            if (
              declaration.id.name === '__dilConstants' &&
              declaration.init?.type === 'CallExpression' &&
              declaration.init.callee.object?.name === 'DIL' &&
              declaration.init.callee.property?.name === 'useConstants'
            ) {
              local.set('__dilConstants', dil.constants)
            } else if (
              declaration.id.name === '__dilModelDataBindings' &&
              declaration.init?.type === 'CallExpression' &&
              declaration.init.callee.object?.name === 'DIL' &&
              declaration.init.callee.property?.name === 'useAppData'
            ) {
              // The native wrapper declares this even when the static view does
              // not use it. Leave it unbound; attempting to read it still fails.
              continue
            } else local.set(declaration.id.name, read(declaration.init, local))
          }
        }
        throw new GenuiError('unsupported-expression')
      }
      if (node.type === 'CallExpression') {
        if (node.callee.type === 'Identifier' && node.callee.name === '__dilSafe') {
          try {
            return read(node.arguments[0], scope)
          } catch (error) {
            if (
              node.arguments.length < 2 ||
              ['resource-limit', 'invalid-code'].includes(error.reason)
            )
              throw error
            const fallback = read(node.arguments[1], scope)
            if (fallback == null) throw error
            recordGenuiError(diagnostics, error)
            diagnostics.localFallbacks += 1
            return fallback
          }
        }
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.name === 'map' &&
          node.arguments.length === 1
        ) {
          const values = read(node.callee.object, scope),
            callback = node.arguments[0]
          if (
            !Array.isArray(values) ||
            values.length > 512 ||
            callback.type !== 'ArrowFunctionExpression' ||
            callback.async ||
            callback.params.length < 1 ||
            callback.params.length > 2 ||
            callback.params.some((param) => param.type !== 'Identifier')
          )
            throw new GenuiError('unsupported-expression')
          return values.map((value, index) => {
            const local = new Map(scope)
            local.set(callback.params[0].name, value)
            if (callback.params[1]) local.set(callback.params[1].name, index)
            return read(callback, local)
          })
        }
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.name === '__dil' &&
          node.callee.property.name === 'jsx'
        ) {
          if (node.arguments[0]?.type === 'ArrowFunctionExpression')
            return read(node.arguments[0], scope)
          const tag = read(node.arguments[0], scope)
          const propsNode = node.arguments[1]
          const props =
            propsNode?.type === 'ObjectExpression'
              ? object(propsNode, scope, true)
              : propsNode
              ? read(propsNode, scope)
              : null
          if (!getGenuiComponent(tag)) {
            const error = new GenuiError('unsupported-component', tag)
            if (props?.fallback == null) throw error
            recordGenuiError(diagnostics, error)
            diagnostics.localFallbacks += 1
            return props.fallback
          }
          return {
            tag,
            props,
            children: node.arguments.slice(2).map((entry) => read(entry, scope)),
          }
        }
      }
      throw new GenuiError('unsupported-expression')
    }
    return { tree: read(render.arguments[0]), reason: null, diagnostics }
  } catch (error) {
    recordGenuiError(diagnostics, error)
    return { tree: null, reason: error.reason || 'invalid-code', diagnostics }
  }
}
