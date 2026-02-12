import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import {
  toToolAlias,
  shouldShortCircuitWithToolLoop,
} from '../src/services/agent/runtime-utils.mjs'
import { AgentProtocol, resolveOpenAiCompatibleProtocol } from '../src/services/agent/protocols.mjs'
import {
  extractTemplateVariables,
  resolvePromptTemplate,
} from '../src/utils/prompt-template-context.mjs'
import { estimateTokenCount } from '../src/utils/token-budget.mjs'
import { parseSkillPackZip } from '../src/services/skills/importer.mjs'

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

function patchCentralDirectoryUncompressedSize(zipBuffer, path, uncompressedSize) {
  const bytes = Buffer.from(zipBuffer)
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue

    const fileNameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    if (fileNameEnd > bytes.length) {
      throw new Error('Invalid ZIP central directory in test fixture')
    }

    const fileName = bytes.subarray(fileNameStart, fileNameEnd).toString('utf-8')
    if (fileName === path) {
      bytes.writeUInt32LE(uncompressedSize >>> 0, offset + 24)
      return bytes
    }

    offset = fileNameEnd + extraLength + commentLength - 1
  }
  throw new Error(`Failed to locate ZIP path in fixture: ${path}`)
}

async function testAliasUniqueness() {
  const longServer = 'server-with-a-very-long-identifier-that-would-usually-truncate-suffix'
  const longTool = 'tool-with-a-very-long-name-that-would-usually-truncate-suffix-and-collide'
  const aliasA = toToolAlias(longServer, longTool, 1)
  const aliasB = toToolAlias(longServer, longTool, 2)

  assert.notEqual(aliasA, aliasB, 'tool aliases must remain unique after truncation')
  assert.ok(aliasA.length <= 64, 'alias must obey 64-char limit')
  assert.ok(aliasB.length <= 64, 'alias must obey 64-char limit')
  assert.ok(aliasA.endsWith('_1'), 'suffix must be preserved in alias A')
  assert.ok(aliasB.endsWith('_2'), 'suffix must be preserved in alias B')
}

async function testShortCircuitDecision() {
  assert.equal(
    shouldShortCircuitWithToolLoop({ status: 'succeeded', answer: 'done', usedTools: false }),
    true,
  )
  assert.equal(
    shouldShortCircuitWithToolLoop(
      { status: 'succeeded', answer: 'done', usedTools: false },
      { requireToolUse: true },
    ),
    false,
  )
  assert.equal(
    shouldShortCircuitWithToolLoop({ status: 'failed', answer: 'done', usedTools: true }),
    false,
  )
  assert.equal(
    shouldShortCircuitWithToolLoop({ status: 'succeeded', answer: '', usedTools: true }),
    false,
  )
}

async function testProtocolResolver() {
  assert.equal(
    resolveOpenAiCompatibleProtocol('https://api.openai.com/v1', AgentProtocol.auto),
    AgentProtocol.openAiChatCompletionsV1,
  )
  assert.equal(
    resolveOpenAiCompatibleProtocol('https://api.openai.com/v1/responses', AgentProtocol.auto),
    AgentProtocol.openAiResponsesV1,
  )
  assert.equal(
    resolveOpenAiCompatibleProtocol('https://api.openai.com/v1', AgentProtocol.openAiResponsesV1),
    AgentProtocol.openAiResponsesV1,
  )
}

async function testTemplateExpansionAndBudget() {
  const variables = extractTemplateVariables(
    'Analyze {{domTree}} with {{styleSummary}} and {{unknown}}',
  )
  assert.deepEqual(variables, ['domtree', 'stylesummary'])

  const pageContext = {
    url: 'https://example.com',
    domTree: '- body\n  - main\n  - footer',
    styleSummary: 'Fonts: Inter\nColor tokens: #111, #fff',
    content: 'x'.repeat(12000),
  }

  const resolved = resolvePromptTemplate(
    'URL: {{url}}\nDOM:\n{{domTree}}\nStyle:\n{{styleSummary}}',
    {
      pageContext,
      preloadTokenCap: 200,
      contextTokenCap: 260,
    },
  )
  assert.ok(resolved.includes('https://example.com'))
  assert.ok(resolved.includes('DOM:'))

  const budgeted = resolvePromptTemplate('Content:\n{{content}}', {
    pageContext,
    preloadTokenCap: 400,
    contextTokenCap: 1000,
  })
  assert.ok(
    estimateTokenCount(budgeted) <= 1000,
    'resolved template should respect configured context cap',
  )
}

async function testSkillImporterZipParsing() {
  const zipBase64 =
    'UEsDBAoAAAAAAJgIS1w3wN1YhQAAAIUAAAAIABwAU0tJTEwubWRVVAkAAzBli2kwZYtpdXgLAAEE9QEAAAQUAAAALS0tCm5hbWU6IEZyb250ZW5kIENyaXRpYwpkZXNjcmlwdGlvbjogQW5hbHl6ZSBwYWdlIGRlc2lnbgp2ZXJzaW9uOiAxLjAuMAotLS0KVXNlIHRoZSBmb2xsb3dpbmcgY2hlY2tsaXN0LgpTZWUgW3JlZmVyZW5jZV0obm90ZXMubWQpClBLAwQKAAAAAACYCEtcXp6heSIAAAAiAAAACAAcAG5vdGVzLm1kVVQJAAMwZYtpMGWLaXV4CwABBPUBAAAEFAAAAC0gY29sb3IgY29udHJhc3QKLSBzcGFjaW5nIHJoeXRobQpQSwECHgMKAAAAAACYCEtcN8DdWIUAAACFAAAACAAYAAAAAAAAAAAApIEAAAAAU0tJTEwubWRVVAUAAzBli2l1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAACYCEtcXp6heSIAAAAiAAAACAAYAAAAAAAAAAAApIHHAAAAbm90ZXMubWRVVAUAAzBli2l1eAsAAQT1AQAABBQAAABQSwUGAAAAAAIAAgCcAAAAKwEAAAAA'

  const parsed = await parseSkillPackZip(bufferToArrayBuffer(Buffer.from(zipBase64, 'base64')))
  assert.equal(parsed.metadata.name, 'Frontend Critic')
  assert.equal(parsed.metadata.version, '1.0.0')
  assert.ok(parsed.instructions.includes('checklist'))
  assert.ok(parsed.resources.some((resource) => resource.path === 'notes.md'))

  const oversizedZip = patchCentralDirectoryUncompressedSize(
    Buffer.from(zipBase64, 'base64'),
    'SKILL.md',
    5 * 1024 * 1024,
  )
  await assert.rejects(
    () => parseSkillPackZip(bufferToArrayBuffer(oversizedZip)),
    /exceeds allowed size/,
  )

  await assert.rejects(() => parseSkillPackZip(new ArrayBuffer(16)), /Invalid ZIP|ZIP is empty/)
}

async function run() {
  await testAliasUniqueness()
  await testShortCircuitDecision()
  await testProtocolResolver()
  await testTemplateExpansionAndBudget()
  await testSkillImporterZipParsing()
  console.log('Agent runtime tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
