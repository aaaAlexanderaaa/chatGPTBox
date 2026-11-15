/* eslint-env node */
import fs from 'node:fs/promises'
import { createHash, webcrypto } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { GEMINI_NATIVE_CONTRACTS } from '../src/config/gemini-web.mjs'
import {
  createCodeReference,
  extractNativeHashes,
} from '../src/services/clients/gemini-web/code-equivalence.mjs'

// Public code only. Call explicitly after inspecting the complete compilation;
// this command never downloads code, runs it, or changes the installed extension.
export async function buildGeminiCodeReference(version, files) {
  const profile = GEMINI_NATIVE_CONTRACTS.find((item) => item.version === version)
  if (!profile?.history) throw new Error('Select a fully inspected Gemini profile with history.')
  const sources = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))
  const hashes = await extractNativeHashes(sources, profile)
  if (
    JSON.stringify(Object.entries(hashes).sort()) !==
    JSON.stringify(Object.entries(profile.hashes).sort())
  )
    throw new Error('Public source does not match every inspected profile fingerprint.')
  const keys = [
    ...Object.values(profile.fields),
    ...Object.entries(profile.history)
      .filter(([key]) => key !== 'apiClass')
      .map(([, value]) => value),
  ]
  return {
    referenceVersion: version,
    sourceSha256: sources.map((source) => createHash('sha256').update(source).digest('hex')),
    ...createCodeReference(sources, keys),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  globalThis.crypto ||= webcrypto
  const [version, output, ...files] = process.argv.slice(2)
  if (!version || !output || files.length < 2)
    throw new Error(
      'Usage: node scripts/build-gemini-code-reference.mjs <exact-version> <output.json> <public-runtime.js> <public-app.js>',
    )
  const reference = await buildGeminiCodeReference(version, files)
  await fs.writeFile(output, JSON.stringify([reference], null, 2) + '\n')
  console.log(
    `Wrote ${reference.units.length} complete public units; ${
      reference.symbols.flat().length
    } consistent rename symbols; all 8 source fingerprints verified.`,
  )
}
