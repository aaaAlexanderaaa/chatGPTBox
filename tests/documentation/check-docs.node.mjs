/* eslint-env node */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { checkDocumentation } from '../../scripts/check-docs.mjs'

const temporaryRoots = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function document(type = 'guide', fields = {}, body = '# Guide\n') {
  const meta = {
    doc_type: type,
    status: 'current',
    authority: type === 'guide' ? 'guidance' : type === 'plan' ? 'planning' : 'normative',
    ...(['contract', 'design'].includes(type)
      ? { implementation: 'partial', verification_status: 'partial' }
      : {}),
    last_reconciled: '2026-10-22',
    ...fields,
  }
  return `---\n${Object.entries(meta)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? JSON.stringify(value) : value}`)
    .join('\n')}\n---\n\n${body}`
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'chatgptbox-docs-'))
  temporaryRoots.push(root)
  const write = (name, content) => {
    const file = path.join(root, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  const policy = {
    version: 1,
    canonicalRoots: ['docs'],
    canonicalFiles: [],
    entrypoints: ['README.md'],
    requiredFiles: ['docs/README.md'],
  }
  write('docs-policy.json', JSON.stringify(policy))
  write('README.md', '# Entry\n\n[Docs](docs/README.md)\n')
  write('docs/README.md', document('authority-map'))
  return {
    root,
    write,
    policy,
    check: () => checkDocumentation(root, { today: '2026-10-23' }),
  }
}

const errors = (result) => result.findings.filter((finding) => finding.severity === 'error')
const has = (result, rule, pattern) =>
  result.findings.some((finding) => finding.rule === rule && pattern.test(finding.message))

test('a valid minimal repository needs no dependencies or product code', () => {
  const f = fixture()
  assert.deepEqual(f.check().findings, [])
  assert.equal(f.check().documents, 2)
})

test('new canonical Markdown without metadata cannot silently escape coverage', () => {
  const f = fixture()
  f.write('docs/nested/new.md', '# Unclassified\n')
  assert.ok(has(f.check(), 'metadata', /frontmatter/))
})

test('required entrypoints and canonical owners must exist', () => {
  const f = fixture()
  rmSync(path.join(f.root, 'README.md'))
  rmSync(path.join(f.root, 'docs/README.md'))
  const result = f.check()
  assert.ok(has(result, 'inventory', /Required document/))
  assert.ok(has(result, 'inventory', /Required canonical/))
})

test('unknown policy keys, empty metadata, duplicate fields, and bad dates fail', () => {
  const f = fixture()
  f.write('docs-policy.json', JSON.stringify({ ...f.policy, silentlyIgnored: true }))
  assert.ok(has(f.check(), 'policy', /Unknown key/))
  f.write('docs-policy.json', JSON.stringify(f.policy))
  f.write(
    'docs/bad.md',
    document('guide', { last_reconciled: '2026-02-30', status: '' }).replace(
      'doc_type: guide',
      'doc_type: guide\ndoc_type: guide\nunsupported_field: yes',
    ),
  )
  const result = f.check()
  assert.ok(has(result, 'metadata', /Duplicate/))
  assert.ok(has(result, 'metadata', /Unknown field/))
  assert.ok(has(result, 'metadata', /date/))
  assert.ok(has(result, 'metadata', /status/))
  f.write('docs/bad.md', document('guide', { last_reconciled: '2099-01-01' }))
  assert.ok(has(f.check(), 'metadata', /future/))
})

test('plans cannot become current authority and a guide cannot claim completed delivery', () => {
  const f = fixture()
  f.write('docs/plan.md', document('plan'))
  f.write('docs/guide.md', document('guide', { status: 'completed' }))
  assert.ok(has(f.check(), 'lifecycle', /plan uses/))
  assert.ok(has(f.check(), 'lifecycle', /Only a plan/))
})

test('normative ownership and implementation/verification are checked independently', () => {
  const f = fixture()
  f.write(
    'docs/contract.md',
    document('contract', {
      authority: 'planning',
      implementation: 'retired',
      verification_status: 'verified',
    }),
  )
  const result = f.check()
  assert.ok(has(result, 'metadata', /requires authority/))
  assert.ok(has(result, 'lifecycle', /retired/))
  assert.ok(has(result, 'evidence', /verification_evidence/))
})

test('live links and fragments fail, including links to renamed source files', () => {
  const f = fixture()
  f.write(
    'docs/guide.md',
    document('guide', {}, '[Missing](../src/renamed.mjs)\n[Heading](README.md#gone)\n'),
  )
  assert.ok(has(f.check(), 'link', /renamed.mjs/))
  assert.ok(has(f.check(), 'fragment', /#gone/))
})

test('frozen history reports broken links as advisories but metadata still fails', () => {
  const f = fixture()
  f.write(
    'docs/history.md',
    document('guide', { status: 'historical' }, '[Old](missing-chat-id)\n'),
  )
  let result = f.check()
  assert.equal(errors(result).length, 0)
  assert.equal(result.findings[0].severity, 'advisory')
  f.write('docs/history.md', document('guide', { status: 'historical', authority: 'normative' }))
  result = f.check()
  assert.ok(errors(result).length > 0)
})

test('fenced/inline code and comments are examples, not live links', () => {
  const f = fixture()
  f.write(
    'docs/guide.md',
    document(
      'guide',
      {},
      '```md\n[example](missing.md)\n```\n~~~md\n[x](absent.md)\n~~~\n`[sample](gone.md)`\n<!--[hidden](no.md)-->\n',
    ),
  )
  assert.deepEqual(f.check().findings, [])
})

test('quoted and nested quoted fences ignore examples but preserve live link locations', () => {
  const f = fixture()
  const examples = [
    '> ```md',
    '> [example](missing.md)',
    '> ```',
    '',
    '  > > ~~~md',
    '  > > [example][missing]',
    '  > > ~~~',
    '',
  ].join('\n')
  f.write('README.md', examples)
  assert.deepEqual(f.check().findings, [])
  f.write('README.md', `${examples}[live](missing.md)\n`)
  const result = f.check()
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].rule, 'link')
  assert.equal(result.findings[0].line, 8)
})

test('an unclosed quoted fence ends when its block quote container ends', () => {
  const f = fixture()
  for (const source of [
    '> ```md\n> [example](ignored.md)\n\n[live](missing.md)\n',
    '> ```md\n> [example](ignored.md)\n\n> [live](missing.md)\n',
    '> > ~~~md\n> > [example](ignored.md)\n> [live](missing.md)\n',
  ]) {
    f.write('README.md', source)
    const result = f.check()
    assert.equal(result.findings.length, 1)
    assert.match(result.findings[0].message, /missing.md/)
  }
})

test('quote markers inside an active fence do not close it', () => {
  const f = fixture()
  f.write(
    'README.md',
    '```md\n> ```\n[example](ignored.md)\n```\n\n> ```md\n> > ```\n> [example](ignored.md)\n> ```\n',
  )
  assert.deepEqual(f.check().findings, [])
})

test('Unicode, repeated headings, setext headings and explicit HTML ids resolve', () => {
  const f = fixture()
  f.write(
    'docs/guide.md',
    document(
      'guide',
      {},
      '# 中文范围\n## Repeat\n## Repeat\nSetext title\n===\n<a id="custom-id"></a>\n',
    ),
  )
  f.write(
    'README.md',
    '[CN](docs/guide.md#中文范围)\n[R](docs/guide.md#repeat-1)\n[S](docs/guide.md#setext-title)\n[ID](docs/guide.md#custom-id)\n',
  )
  assert.deepEqual(f.check().findings, [])
})

test('heading emphasis uses visible text while literal underscores remain in anchors', () => {
  const f = fixture()
  f.write(
    'docs/guide.md',
    document(
      'guide',
      {},
      '# _Setup_\n## __Setup__\n## ___Setup___\n## __Nested _emphasis___\n## snake_case\n## `_literal_`\n## \\_escaped\\_\n',
    ),
  )
  f.write(
    'README.md',
    ['setup', 'setup-1', 'setup-2', 'nested-emphasis', 'snake_case', '_literal_', '_escaped_']
      .map((anchor) => `[Heading](docs/guide.md#${anchor})\n`)
      .join(''),
  )
  assert.deepEqual(f.check().findings, [])
})

test('reference-linked headings use link text and share duplicate heading numbering', () => {
  const f = fixture()
  f.write(
    'docs/guide.md',
    document(
      'guide',
      {},
      '# [Setup][entry]\n## [_Setup_][ENTRY]\n## [Setup][]\n## [Setup]\n\n[entry]: README.md\n[Setup]: README.md\n',
    ),
  )
  f.write(
    'README.md',
    ['setup', 'setup-1', 'setup-2', 'setup-3']
      .map((anchor) => `[Heading](docs/guide.md#${anchor})\n`)
      .join(''),
  )
  assert.deepEqual(f.check().findings, [])
})

test('raw heading markup does not create extra fragment aliases', () => {
  const f = fixture()
  f.write(
    'docs/guide.md',
    document('guide', {}, '# _Setup_\n## [Setup][entry]\n\n[entry]: README.md\n'),
  )
  f.write('README.md', '[Emphasis](docs/guide.md#_setup_)\n[Reference](docs/guide.md#setupentry)\n')
  const result = f.check()
  assert.equal(errors(result).length, 2)
  assert.ok(result.findings.every((finding) => finding.rule === 'fragment'))
})

test('nested parentheses, angle destinations and reference-style links are checked', () => {
  const f = fixture()
  f.write('src/file(name).mjs', '')
  f.write('src/with space.mjs', '')
  f.write(
    'README.md',
    '[nested](src/file(name).mjs)\n[space](<src/with space.mjs>)\n[full][guide]\n[guide][]\n[guide]\n[guide]: docs/README.md#guide\n',
  )
  assert.deepEqual(f.check().findings, [])
  f.write('README.md', '[missing][undefined]\n')
  assert.ok(has(f.check(), 'link', /Undefined reference/))
})

test('external URLs are not fetched and broken local URL encoding is reported', () => {
  const f = fixture()
  f.write('README.md', '[web](https://example.invalid/never-fetched)\n[bad](docs/%ZZ.md)\n')
  assert.equal(f.check().findings.length, 1)
  assert.ok(has(f.check(), 'link', /encoding/))
})

test('existing files outside the repository, file URLs and symlink escapes fail', () => {
  const f = fixture()
  const outside = mkdtempSync(path.join(tmpdir(), 'chatgptbox-outside-'))
  temporaryRoots.push(outside)
  writeFileSync(path.join(outside, 'private.md'), '# Private\n')
  symlinkSync(outside, path.join(f.root, 'external'))
  f.write(
    'README.md',
    '[outside](external/private.md)\n[file](file:///tmp/private.md)\n[escape](../../private.md)\n',
  )
  const result = f.check()
  assert.ok(has(result, 'link', /escapes/))
  assert.ok(has(result, 'link', /not portable/))
})

test('canonical tree symlinks cannot hide uncontrolled Markdown', () => {
  const f = fixture()
  symlinkSync('README.md', path.join(f.root, 'docs/alias.md'))
  assert.ok(has(f.check(), 'inventory', /symlinks/))
})

test('supersession is reciprocal and cannot promote evidence or planning into a contract', () => {
  const f = fixture()
  f.write(
    'docs/old.md',
    document('contract', { status: 'superseded', superseded_by: ['docs/new.md'] }),
  )
  f.write('docs/new.md', document('contract', { supersedes: ['docs/old.md'] }))
  assert.deepEqual(f.check().findings, [])
  f.write('docs/new.md', document('contract'))
  assert.ok(has(f.check(), 'relationship', /reciprocal/))
  f.write('docs/new.md', document('plan', { status: 'active', supersedes: ['docs/old.md'] }))
  assert.ok(has(f.check(), 'relationship', /keep document type/))
})

test('supersession cycles and escaping metadata relationships fail', () => {
  const f = fixture()
  f.write(
    'docs/a.md',
    document('guide', {
      status: 'superseded',
      superseded_by: ['docs/b.md'],
      supersedes: ['docs/b.md'],
    }),
  )
  f.write(
    'docs/b.md',
    document('guide', {
      status: 'superseded',
      superseded_by: ['docs/a.md'],
      supersedes: ['docs/a.md'],
    }),
  )
  assert.ok(has(f.check(), 'relationship', /cycle/))
  f.write(
    'docs/a.md',
    document('guide', { status: 'superseded', superseded_by: ['../../private.md'] }),
  )
  assert.ok(has(f.check(), 'relationship', /escapes/))
})

test('only current guides can project current normative contracts; date drift is advisory', () => {
  const f = fixture()
  f.write('docs/contract.md', document('contract', { last_reconciled: '2026-10-23' }))
  f.write('docs/guide.md', document('guide', { projection_of: ['docs/contract.md'] }))
  let result = f.check()
  assert.equal(errors(result).length, 0)
  assert.ok(has(result, 'projection', /later source/))
  f.write('docs/contract.md', document('contract', { status: 'target' }))
  assert.ok(has(f.check(), 'projection', /current contract/))
  f.write('docs/contract.md', document('contract'))
  f.write(
    'docs/guide.md',
    document('guide', { status: 'historical', projection_of: ['docs/contract.md'] }),
  )
  assert.ok(has(f.check(), 'projection', /Only a current guide/))
})

test('a malformed policy is an actionable failure, not a thrown JSON exception', () => {
  const f = fixture()
  f.write('docs-policy.json', '{')
  assert.ok(has(f.check(), 'policy', /Cannot read policy/))
  f.write('docs-policy.json', JSON.stringify({ ...f.policy, canonicalRoots: ['../../outside'] }))
  assert.ok(has(f.check(), 'policy', /escaping path/))
})

test('empty managed scope cannot report a vacuous metadata pass', () => {
  const f = fixture()
  f.write('docs-policy.json', JSON.stringify({ ...f.policy, canonicalRoots: [] }))
  assert.ok(has(f.check(), 'policy', /At least one canonical/))
})

test('a verified contract cannot use an unfinished plan as completion evidence', () => {
  const f = fixture()
  f.write('docs/plan.md', document('plan', { status: 'active' }))
  f.write(
    'docs/contract.md',
    document('contract', {
      verification_status: 'verified',
      verification_evidence: ['docs/plan.md'],
    }),
  )
  assert.ok(has(f.check(), 'evidence', /must be completed/))
  f.write('docs/plan.md', document('plan', { status: 'completed' }))
  assert.deepEqual(f.check().findings, [])
})

test('an empty projection field still cannot turn a plan into a current guide', () => {
  const f = fixture()
  f.write('docs/plan.md', document('plan', { status: 'active', projection_of: [] }))
  assert.ok(has(f.check(), 'projection', /Only a current guide/))
})

test('the PR documentation gate covers docs-only and checker changes without a build', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/docs-check.yml', import.meta.url),
    'utf8',
  )
  for (const entry of [
    '**/*.md',
    'docs-policy.json',
    'scripts/check-docs.mjs',
    'tests/documentation/**',
    'src/**',
  ]) {
    assert.ok(workflow.includes(`"${entry}"`), `Missing workflow path: ${entry}`)
  }
  assert.match(workflow, /npm run docs:test/)
  assert.match(workflow, /npm run docs:check/)
  assert.doesNotMatch(workflow, /npm run build/)
})
