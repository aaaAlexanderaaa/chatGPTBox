/* eslint-env node */
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { tokenizer } from 'acorn'
import { GEMINI_NATIVE_CONTRACTS } from '../src/config/gemini-web.mjs'
import {
  extractNativeHashes,
  matchCodeReference,
  renameReferenceCode,
} from '../src/services/clients/gemini-web/code-equivalence.mjs'

const [referenceFile, reportFile, ...files] = process.argv.slice(2)
if (!referenceFile || !reportFile || files.length < 2)
  throw new Error(
    'Usage: node scripts/check-gemini-code-reference.mjs <reference.json> <report.json> <public-runtime.js> <public-app.js>',
  )
const [reference] = JSON.parse(await fs.readFile(referenceFile, 'utf8'))
const profile = GEMINI_NATIVE_CONTRACTS.find((item) => item.version === reference.referenceVersion)
const sources = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))
assert.ok(matchCodeReference(sources, reference), 'The complete inspected source must match.')
assert.deepEqual(await extractNativeHashes(sources, profile), profile.hashes)
const renamed = renameReferenceCode(sources, reference)
const match = matchCodeReference(renamed, reference)
assert.ok(match, 'The complete consistently renamed source must match.')
const renamedBytes = renamed.reduce((total, source) => total + Buffer.byteLength(source), 0)
assert.ok(
  renamedBytes <= 8 * 1024 * 1024,
  'The renamed compilation must fit the production read budget.',
)
const rename = (name) => match.names.fields.get(name) || name
const namespace = (name) => match.names.namespace.get(name) || name
const derived = {
  ...profile,
  fields: Object.fromEntries(
    Object.entries(profile.fields).map(([key, value]) => [key, rename(value)]),
  ),
  history: Object.fromEntries(
    Object.entries(profile.history).map(([key, value]) => [
      key,
      key === 'apiClass' ? namespace(value) : rename(value),
    ]),
  ),
}
for (const key of [
  'viewMap',
  'inputClass',
  'serviceClass',
  'prepareFunction',
  'attestationFunction',
  'thinkingSetter',
])
  derived[key] = namespace(profile[key])
for (const key of [
  'viewMap',
  'inputClass',
  'serviceClass',
  'prepareFunction',
  'attestationFunction',
  'thinkingSetter',
])
  assert.notEqual(derived[key], profile[key], `The real ${key} must be renameable.`)
assert.notEqual(derived.fields.submit, profile.fields.submit)
const hashes = await extractNativeHashes(renamed, derived)
assert.equal(Object.keys(hashes).length, 8)
const baseTokens = tokenizer(sources[0], { ecmaVersion: 'latest' })
let mutation
for (;;) {
  const token = baseTokens.getToken()
  if (token.type.label === 'eof') throw new Error('No runtime dependency constant found.')
  if (token.type.label === 'num' && token.value === 0) {
    mutation = sources[0].slice(0, token.start) + '1' + sources[0].slice(token.end)
    break
  }
}
const changed = [mutation, ...sources.slice(1)]
assert.deepEqual(
  await extractNativeHashes(changed, profile),
  profile.hashes,
  'The native roots must remain unchanged in the dependency-mutation test.',
)
assert.equal(
  matchCodeReference(changed, reference),
  null,
  'A changed runtime dependency must refuse.',
)
assert.equal(matchCodeReference(renamed.slice(1), reference), null, 'Incomplete code must refuse.')
const report = {
  referenceVersion: profile.version,
  units: sources.length,
  completeSourceMatch: true,
  originalNativeFingerprints: 8,
  consistentRenamedSymbols: Object.values(match.names).reduce(
    (total, names) => total + names.size,
    0,
  ),
  criticalNamespaceRenames: Object.fromEntries(
    [
      'viewMap',
      'inputClass',
      'serviceClass',
      'prepareFunction',
      'attestationFunction',
      'thinkingSetter',
    ].map((key) => [key, namespace(profile[key]) !== profile[key]]),
  ),
  renamedBytes,
  renamedNativeFingerprints: Object.keys(hashes).length,
  dependencyMutationWithUnchangedRootsRefused: true,
  missingUnitRefused: true,
  modelSubmissions: 0,
  evaluatedWebsiteCode: false,
}
await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
