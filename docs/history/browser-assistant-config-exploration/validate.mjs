// Validate the proposed contracts and examples without invoking a model or browser.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Ajv = require('ajv')
const ajv = new Ajv({ allErrors: true, strictKeywords: true })
const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const [schema, bundle, contracts, fixture] = await Promise.all([
  readJson('./config.schema.json'),
  readJson('./examples.json'),
  readJson('./contracts.json'),
  readJson('./registry.fixture.json'),
])
const ensure = (condition, message) => {
  if (!condition) throw new Error(message)
}
const validateWith = (contract, data, label) => {
  const validate = ajv.compile(contract)
  ensure(validate(data), `${label}: ${ajv.errorsText(validate.errors)}`)
}
validateWith(schema, bundle, 'bundle')
validateWith(schema, { version: 1, name: 'TL;DR', prompt: '{{url}} TL;DR' }, 'minimal recipe')
for (const [id, contract] of Object.entries(contracts)) {
  ensure(ajv.validateSchema(contract), `${id}: invalid JSON Schema`)
}
for (const [id, descriptor] of Object.entries(fixture.interfaces)) {
  ensure(ajv.validateSchema(descriptor.configSchema), `${id}: invalid config schema`)
}
const ids = new Set(bundle.recipes.map((recipe) => recipe.id))
ensure(ids.size === bundle.recipes.length, 'duplicate recipe IDs')
ensure(
  new Set(bundle.groups.map((group) => group.id)).size === bundle.groups.length,
  'duplicate group IDs',
)
for (const group of bundle.groups) {
  for (const id of group.recipes) ensure(ids.has(id), `${group.id}: missing recipe ${id}`)
}
const resolve = (id, kind, label) => {
  if (id.startsWith('@')) {
    ensure(bundle.slots[id.slice(1)]?.kind === kind, `${label}: missing ${kind} slot ${id}`)
    return null // Local connection binding and its real capabilities remain unresolved.
  }
  const descriptor = fixture.interfaces[id]
  ensure(descriptor?.kind === kind, `${label}: unknown ${kind} ${id}`)
  return descriptor
}
const checkRequest = (request, kind, label) => {
  const descriptor = resolve(request.use, kind, label)
  if (descriptor) validateWith(descriptor.configSchema, request.with || {}, label)
  return descriptor
}
const walkStrings = (value, visit) => {
  if (typeof value === 'string') visit(value)
  else if (Array.isArray(value)) value.forEach((item) => walkStrings(item, visit))
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => walkStrings(item, visit))
}
for (const recipe of bundle.recipes) {
  if (recipe.engine) resolve(recipe.engine, 'engine', recipe.id)
  if (recipe.inputs)
    ensure(ajv.validateSchema(recipe.inputs), `${recipe.id}: invalid inputs schema`)
  const runner = recipe.runner || { use: 'box.generate' }
  const descriptor = checkRequest(runner, 'runner', recipe.id)
  if (descriptor?.needsPrompt) ensure(recipe.prompt, `${recipe.id}: runner requires prompt`)
  if (Object.keys(recipe.tools || {}).length)
    ensure(descriptor?.acceptsTools, `${recipe.id}: runner cannot execute tools`)
  for (const [alias, request] of Object.entries(recipe.resources || {}))
    checkRequest(request, 'resource', `${recipe.id}.${alias}`)
  for (const [alias, request] of Object.entries(recipe.tools || {}))
    checkRequest(request, 'tool', `${recipe.id}.${alias}`)
  if (runner.use === 'box.tool') resolve(runner.with.tool, 'tool', recipe.id)
  const responseSchema =
    typeof recipe.response?.schema === 'string'
      ? contracts[recipe.response.schema]
      : recipe.response?.schema
  if (recipe.response) ensure(responseSchema, `${recipe.id}: unknown response schema`)
  if (responseSchema)
    ensure(ajv.validateSchema(responseSchema), `${recipe.id}: invalid response schema`)
  for (const output of recipe.outputs || [{ use: 'panel.markdown' }]) {
    checkRequest(output, 'output', recipe.id)
    if (output.select) {
      ensure(responseSchema, `${recipe.id}: structured selector needs a response schema`)
      let cursor = responseSchema
      for (const escaped of output.select.slice(1).split('/')) {
        ensure(!/~(?:[^01]|$)/.test(escaped), `${recipe.id}: malformed JSON Pointer`)
        const key = escaped.replace(/~1/g, '/').replace(/~0/g, '~')
        cursor = cursor?.properties?.[key]
        ensure(cursor, `${recipe.id}: output path ${output.select} is absent from schema`)
      }
    }
  }
  const builtins = new Set(['selection', 'content', 'url', 'title', 'language'])
  const aliases = new Set([...builtins, ...Object.keys(recipe.resources || {})])
  walkStrings(
    {
      prompt: recipe.prompt,
      attachments: recipe.attachments,
      resources: recipe.resources,
      tools: recipe.tools,
      runner: recipe.runner,
      outputs: recipe.outputs,
    },
    (value) => {
      for (const match of value.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)) {
        const [root, inputKey] = match[1].split('.')
        ensure(root === 'inputs' || aliases.has(root), `${recipe.id}: unknown variable ${root}`)
        if (root === 'inputs')
          ensure(recipe.inputs?.properties?.[inputKey], `${recipe.id}: unknown input ${inputKey}`)
      }
    },
  )
}
console.log(
  `Validated minimal recipe, ${bundle.recipes.length} recipes, ${bundle.groups.length} groups, ${
    Object.keys(contracts).length
  } result schemas, and ${Object.keys(fixture.interfaces).length} interface fixtures.`,
)
console.log(
  'Checks cover configuration structure and declared references. Live bindings, resource values, model output, and page anchors are not executed.',
)
