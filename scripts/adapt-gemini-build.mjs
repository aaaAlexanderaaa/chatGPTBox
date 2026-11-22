/* eslint-env node */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GEMINI_NATIVE_CONTRACTS } from '../src/config/gemini-web.mjs'
import {
  auditReceiverCohort,
  discoverStructuralGeminiContract,
} from '../src/services/clients/gemini-web/structural-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const MAX_BYTES = 8 * 1024 * 1024

function validatePublicUrl(raw) {
  const url = new URL(raw)
  const decodedPath = decodeURIComponent(url.pathname)
  const version = url.pathname.match(/\/k=([^/]+)\//)?.[1]
  if (
    url.origin !== 'https://gemini.gstatic.com' ||
    url.username ||
    url.password ||
    url.hash ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(decodedPath) ||
    (!url.pathname.startsWith('/_/js/') &&
      !url.pathname.startsWith('/_/mss/boq-gemini-web-uiserver/_/js/')) ||
    (url.search && !/^\?wli=BardChatUi\.[a-zA-Z0-9_.%:-]{1,200}$/.test(url.search)) ||
    !version ||
    !/^boq-gemini-web-uiserver\.BardChatUi\.[a-zA-Z0-9_.-]{1,180}$/.test(version)
  )
    throw new Error(`Refused non-public or invalid Gemini bundle URL: ${raw}`)
  return { url: url.href, version }
}

async function fetchPublicSource(raw) {
  const { url, version } = validatePublicUrl(raw)
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    redirect: 'error',
  })
  if (!response.ok || (response.url && response.url !== url))
    throw new Error(`Failed to fetch public bundle (${response.status}): ${url}`)
  const text = await response.text()
  return { text, version, label: url }
}

async function loadInputs(inputs, explicitVersion) {
  const loaded = []
  let totalBytes = 0
  let inferredVersion = explicitVersion || ''
  for (const input of inputs) {
    let item
    if (/^https?:\/\//.test(input)) {
      item = await fetchPublicSource(input)
      if (inferredVersion && inferredVersion !== item.version)
        throw new Error(`Mismatched versions: ${inferredVersion} vs ${item.version}`)
      inferredVersion = item.version
    } else {
      const text = await fs.readFile(input, 'utf8')
      item = { text, version: inferredVersion, label: input }
    }
    totalBytes += Buffer.byteLength(item.text, 'utf8')
    if (totalBytes > MAX_BYTES) throw new Error('Public code exceeds the 8 MiB inspection limit.')
    loaded.push(item)
  }
  if (!inferredVersion)
    throw new Error('Pass public gemini.gstatic.com URLs or supply --version <exact-version>.')
  // Order runtime first (smaller bootstrap unit) and app second.
  loaded.sort((a, b) => a.text.length - b.text.length)
  return { version: inferredVersion, sources: loaded.map((item) => item.text) }
}

function formatNodeTypesBlock(nodeTypes) {
  if (!nodeTypes) return []
  return [
    '    nodeTypes: {',
    ...Object.entries(nodeTypes).map(([k, v]) =>
      Array.isArray(v) ? `      ${k}: [${v.join(', ')}],` : `      ${k}: ${v},`,
    ),
    '    },',
  ]
}

function formatContractBlock(contract) {
  const kv = (obj, indent) =>
    Object.entries(obj)
      .map(([k, v]) => `${indent}${k}: '${v}',`)
      .join('\n')
  return [
    '  {',
    `    version: '${contract.version}',`,
    `    viewMap: '${contract.viewMap}',`,
    `    inputClass: '${contract.inputClass}',`,
    `    serviceClass: '${contract.serviceClass}',`,
    `    prepareFunction: '${contract.prepareFunction}',`,
    `    attestationFunction: '${contract.attestationFunction}',`,
    `    thinkingSetter: '${contract.thinkingSetter}',`,
    `    dictationIndicator: '${contract.dictationIndicator}',`,
    '    history: {',
    kv(contract.history, '      '),
    '    },',
    '    fields: {',
    kv(contract.fields, '      '),
    '    },',
    ...formatNodeTypesBlock(contract.nodeTypes),
    '    hashes: {',
    kv(contract.hashes, '      '),
    '    },',
    '    modelDescription: GEMINI_WEB_MODEL_DESCRIPTION,',
    '    thinkingLevel: GEMINI_WEB_THINKING_LEVEL,',
    '  },',
  ].join('\n')
}

function formatCohortBlock(cohort) {
  const quoted = (arr) => arr.map((item) => `'${item}'`).join(', ')
  return [
    '  {',
    '    unitSha3: [',
    `      '${cohort.unitSha3[0]}',`,
    `      '${cohort.unitSha3[1]}',`,
    '    ],',
    `    unavailableExports: [${quoted(cohort.unavailableExports)}],`,
    `    staticAllows: [${quoted(cohort.staticAllows)}],`,
    '  },',
  ].join('\n')
}

function formatMemoizerBlock(memoizer) {
  const codeLines = Object.entries(memoizer.code)
    .map(([k, v]) => `      ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: '${v}',`)
    .join('\n')
  return [
    '  {',
    `    wrapper: '${memoizer.wrapper}',`,
    `    weakMapVar: '${memoizer.weakMapVar}',`,
    '    code: {',
    codeLines,
    '    },',
    '  },',
  ].join('\n')
}

function diffContract(next, previous) {
  if (!previous) return []
  const changes = []
  for (const key of [
    'viewMap',
    'inputClass',
    'serviceClass',
    'prepareFunction',
    'attestationFunction',
    'thinkingSetter',
  ]) {
    if (next[key] !== previous[key]) changes.push(`${key}: ${previous[key]} -> ${next[key]}`)
  }
  for (const [key, val] of Object.entries(next.history)) {
    if (val !== previous.history?.[key])
      changes.push(`history.${key}: ${previous.history?.[key]} -> ${val}`)
  }
  for (const [key, val] of Object.entries(next.fields)) {
    if (val !== previous.fields?.[key])
      changes.push(`fields.${key}: ${previous.fields?.[key]} -> ${val}`)
  }
  if (next.nodeTypes && JSON.stringify(next.nodeTypes) !== JSON.stringify(previous.nodeTypes)) {
    for (const [key, val] of Object.entries(next.nodeTypes)) {
      if (JSON.stringify(val) !== JSON.stringify(previous.nodeTypes?.[key]))
        changes.push(
          `nodeTypes.${key}: ${JSON.stringify(previous.nodeTypes?.[key])} -> ${JSON.stringify(
            val,
          )}`,
        )
    }
  }
  return changes
}

async function applyUpdates(contract, cohort, sources) {
  const unknownDeferred = cohort.deferredFeatures.filter((item) => item.kind === 'unknown')
  if (unknownDeferred.length) {
    throw new Error(
      `Refused --write: unknown deferred exports require manual audit: ${unknownDeferred
        .map((item) => item.name)
        .join(', ')}`,
    )
  }
  if (!cohort.staticAllows.length || !cohort.identityMemoizer) {
    throw new Error(
      'Refused --write: staticAllows or Closure identity memoizer could not be confirmed.',
    )
  }

  // 1. Update src/config/gemini-web.mjs if version not already present
  const configPath = path.join(root, 'src/config/gemini-web.mjs')
  const configText = await fs.readFile(configPath, 'utf8')
  if (!configText.includes(`version: '${contract.version}'`)) {
    const marker = 'export const GEMINI_NATIVE_CONTRACTS = Object.freeze([\n'
    const idx = configText.indexOf(marker)
    if (idx < 0) throw new Error('Could not find GEMINI_NATIVE_CONTRACTS anchor.')
    const updated =
      configText.slice(0, idx + marker.length) +
      formatContractBlock(contract) +
      '\n' +
      configText.slice(idx + marker.length)
    await fs.writeFile(configPath, updated, 'utf8')
    console.log(`Updated ${path.relative(root, configPath)}`)
  } else {
    console.log(`Profile ${contract.version} already present in src/config/gemini-web.mjs`)
  }

  // 2. Update src/services/clients/gemini-web/namespace-receivers.mjs if needed
  const receiversPath = path.join(root, 'src/services/clients/gemini-web/namespace-receivers.mjs')
  let receiversText = await fs.readFile(receiversPath, 'utf8')
  let receiversChanged = false
  if (!receiversText.includes(cohort.unitSha3[0])) {
    const marker = '\n]\n\nconst IDENTITY_MEMOIZERS = ['
    const idx = receiversText.indexOf(marker)
    if (idx < 0) throw new Error('Could not find REVIEWED_COHORTS anchor.')
    receiversText =
      receiversText.slice(0, idx) + '\n' + formatCohortBlock(cohort) + receiversText.slice(idx)
    receiversChanged = true
  }
  const wrapperHash = cohort.identityMemoizer.code[cohort.identityMemoizer.wrapper]
  if (!receiversText.includes(wrapperHash)) {
    const marker = '\n]\n\nexport function verifyNamespaceReceivers('
    const idx = receiversText.indexOf(marker)
    if (idx < 0) throw new Error('Could not find IDENTITY_MEMOIZERS anchor.')
    receiversText =
      receiversText.slice(0, idx) +
      '\n' +
      formatMemoizerBlock(cohort.identityMemoizer) +
      receiversText.slice(idx)
    receiversChanged = true
  }
  if (receiversChanged) {
    await fs.writeFile(receiversPath, receiversText, 'utf8')
    console.log(`Updated ${path.relative(root, receiversPath)}`)
  }

  // 3. Rebuild and verify src/config/gemini-code-references.json in a clean temp directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-adapt-'))
  try {
    const unitFiles = []
    for (let i = 0; i < sources.length; i++) {
      const filePath = path.join(tmpDir, `unit-${i}.js`)
      await fs.writeFile(filePath, sources[i], 'utf8')
      unitFiles.push(filePath)
    }
    const refOut = path.join(tmpDir, 'ref.json')
    const reportOut = path.join(tmpDir, 'report.json')
    const buildRes = spawnSync(
      process.execPath,
      ['scripts/build-gemini-code-reference.mjs', contract.version, refOut, ...unitFiles],
      { cwd: root, stdio: 'inherit' },
    )
    if (buildRes.status !== 0) throw new Error('build-gemini-code-reference.mjs failed.')
    const checkRes = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=512',
        'scripts/check-gemini-code-reference.mjs',
        refOut,
        reportOut,
        ...unitFiles,
      ],
      { cwd: root, stdio: 'inherit' },
    )
    if (checkRes.status !== 0) throw new Error('check-gemini-code-reference.mjs failed.')
    const targetRef = path.join(root, 'src/config/gemini-code-references.json')
    await fs.copyFile(refOut, targetRef)
    console.log(`Verified and wrote ${path.relative(root, targetRef)}`)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

export async function runAdaptCli(argv) {
  globalThis.crypto ||= webcrypto
  const write = argv.includes('--write')
  const versionFlag = argv.indexOf('--version')
  const explicitVersion = versionFlag >= 0 ? argv[versionFlag + 1] : ''
  const inputs = argv.filter(
    (arg, i) => !arg.startsWith('--') && (versionFlag < 0 || i !== versionFlag + 1),
  )
  if (inputs.length < 2) {
    throw new Error(
      'Usage: node scripts/adapt-gemini-build.mjs <m=_b URL|file> <m=vLefie URL|file> [--version <k>] [--write]',
    )
  }

  const { version, sources } = await loadInputs(inputs, explicitVersion)
  const { contract, reason } = await discoverStructuralGeminiContract(sources, version, {
    returnDetails: true,
  })
  if (!contract) throw new Error(`Structural verification failed: ${reason}`)

  const cohort = auditReceiverCohort(sources)
  const previous = GEMINI_NATIVE_CONTRACTS[0]
  const changes = diffContract(contract, previous)

  console.log(`Version: ${contract.version}`)
  console.log(`Changed symbols vs ${previous?.version || 'none'}: ${changes.length}`)
  for (const line of changes) console.log(`  - ${line}`)
  console.log(
    `Deferred exports: ${
      cohort.deferredFeatures.map((d) => `${d.name}(${d.kind})`).join(', ') || 'none'
    }`,
  )
  console.log(`Static allows: ${cohort.staticAllows.join(', ') || 'none'}`)
  console.log(
    `Memoizer: ${
      cohort.identityMemoizer
        ? `${cohort.identityMemoizer.wrapper} (weakMap=${cohort.identityMemoizer.weakMapVar})`
        : 'none'
    }`,
  )

  if (write) {
    await applyUpdates(contract, cohort, sources)
    console.log('\nNext steps:')
    console.log(
      '  1. npm run lint && npm test -- tests/gemini-native-runtime.test.mjs tests/gemini-code-equivalence.test.mjs',
    )
    console.log(
      '  2. npm run build:extension:fast   (or npm run build:extension for all 4 archives)',
    )
    console.log('  3. Reload ChatGPTBox in brave://extensions and click "Check Gemini page".')
  } else {
    console.log(
      '\nDry run complete (no files modified). Re-run with --write to update repository files.',
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAdaptCli(process.argv.slice(2)).catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
