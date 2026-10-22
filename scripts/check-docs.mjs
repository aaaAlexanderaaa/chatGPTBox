/* eslint-env node */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const authorities = {
  'authority-map': 'normative',
  architecture: 'normative',
  contract: 'normative',
  design: 'normative',
  plan: 'planning',
  guide: 'guidance',
  'decision-log': 'evidence',
  evidence: 'evidence',
}
const statuses = new Set([
  'current',
  'target',
  'active',
  'needs_reconciliation',
  'completed',
  'historical',
  'superseded',
])
const implementations = new Set(['not_started', 'in_progress', 'partial', 'implemented', 'retired'])
const verifications = new Set(['pending', 'partial', 'verified', 'not_applicable'])
const relationships = ['supersedes', 'superseded_by', 'projection_of', 'verification_evidence']
const metadataKeys = new Set([
  'doc_type',
  'status',
  'authority',
  'last_reconciled',
  'implementation',
  'verification_status',
  ...relationships,
])
const frozen = new Set(['historical', 'completed', 'superseded'])
const blank = (value) => value.replace(/[^\n]/g, ' ')
const normalizeReference = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase()
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function stripQuotePrefix(line, limit = Infinity) {
  let depth = 0
  while (depth < limit) {
    const prefix = line.match(/^ {0,3}>[ \t]?/)
    if (!prefix) break
    line = line.slice(prefix[0].length)
    depth += 1
  }
  return { content: line, depth }
}

function withoutFences(source) {
  let fence = null
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .split('\n')
    .map((line) => {
      let quote = stripQuotePrefix(line, fence?.quoteDepth)
      // An unclosed fence ends with its containing block quote. Extra quote
      // markers inside the fence are code, so strip only the opening depth.
      if (fence && quote.depth < fence.quoteDepth) fence = null
      if (!fence) quote = stripQuotePrefix(line)
      const match = quote.content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (!fence && match) {
        fence = { marker: match[1], quoteDepth: quote.depth }
        return blank(line)
      }
      if (fence) {
        if (
          match &&
          match[1][0] === fence.marker[0] &&
          match[1].length >= fence.marker.length &&
          !match[2].trim()
        ) {
          fence = null
        }
        return blank(line)
      }
      return line
    })
    .join('\n')
}

function referenceDefinitions(source) {
  return [...source.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm)].map((match) => ({
    label: normalizeReference(match[1]),
    href: match[2] || match[3],
    index: match.index,
  }))
}

function withoutUnderscoreEmphasis(source) {
  const whitespace = (char) => !char || /\s/u.test(char)
  const punctuation = (char) => !!char && /[\p{P}\p{S}]/u.test(char)
  const runs = []
  const openers = []
  for (const match of source.matchAll(/_+/g)) {
    const before = source[match.index - 1]
    const after = source[match.index + match[0].length]
    const left =
      !whitespace(after) && (!punctuation(after) || whitespace(before) || punctuation(before))
    const right =
      !whitespace(before) && (!punctuation(before) || whitespace(after) || punctuation(after))
    const run = {
      length: match[0].length,
      remaining: match[0].length,
      canOpen: left && (!right || punctuation(before)),
      canClose: right && (!left || punctuation(after)),
    }
    if (run.canClose) {
      while (run.remaining) {
        const index = openers.findLastIndex(
          (opener) =>
            !(
              (opener.canClose || run.canOpen) &&
              (opener.length + run.length) % 3 === 0 &&
              (opener.length % 3 !== 0 || run.length % 3 !== 0)
            ),
        )
        if (index === -1) break
        const opener = openers[index]
        const count = Math.min(opener.remaining, run.remaining)
        opener.remaining -= count
        run.remaining -= count
        openers.splice(index + (opener.remaining ? 1 : 0))
      }
    }
    if (run.canOpen && run.remaining) openers.push(run)
    runs.push(run)
  }
  let cursor = 0
  return source.replace(/_+/g, () => '_'.repeat(runs[cursor++].remaining))
}

function headingText(source, references) {
  const literals = []
  // Protect code and escaped punctuation before interpreting link/emphasis
  // markup, so code identifiers and literal underscores keep their anchors.
  const protectedText = source.replace(
    /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)|\\([\\`*_[\]<>])/g,
    (_match, _ticks, code, escaped) => {
      const text = code === undefined ? escaped : code
      const literal =
        code?.startsWith(' ') && code.endsWith(' ') && /\S/.test(code) ? code.slice(1, -1) : text
      literals.push(literal)
      return `\0${literals.length - 1}\0`
    },
  )
  const text = protectedText
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (match, label, reference) =>
      references.has(normalizeReference(reference || label)) ? label : match,
    )
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|apos);/g, '')
  return withoutUnderscoreEmphasis(text).replace(/\0(\d+)\0/g, (_match, index) => literals[index])
}

function headingAnchors(source) {
  const clean = withoutFences(source)
  const references = new Map(referenceDefinitions(clean).map(({ label, href }) => [label, href]))
  const anchors = new Set()
  const used = new Set()
  const lines = clean.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const atx = lines[i].match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$/)
    const setext = i > 0 && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i]) && lines[i - 1].trim()
    if (!atx && !setext) continue
    const title = headingText(atx ? atx[1] : lines[i - 1], references)
    const slug = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
      .replace(/\s/g, '-')
    let unique = slug
    let count = 0
    while (used.has(unique)) unique = `${slug}-${++count}`
    used.add(unique)
    anchors.add(unique)
  }
  for (const match of clean.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) {
    anchors.add(match[1])
  }
  return anchors
}

function markdownLinks(source) {
  const clean = withoutFences(source).replace(/(`+)([^\n]*?)\1/g, blank)
  const links = []
  // Balance parentheses so source links such as file(name).md remain intact.
  for (const match of clean.matchAll(/\]\(/g)) {
    let cursor = match.index + 2
    while (/\s/.test(clean[cursor] || '') && cursor < clean.length) cursor += 1
    const start = cursor
    if (clean[cursor] === '<') {
      const end = clean.indexOf('>', cursor + 1)
      if (end !== -1) links.push({ href: clean.slice(cursor + 1, end), index: match.index })
      continue
    }
    let depth = 0
    while (cursor < clean.length) {
      const char = clean[cursor]
      if (char === '\\') {
        cursor += 2
        continue
      }
      if (char === '(') depth += 1
      if (char === ')') {
        if (!depth) break
        depth -= 1
      }
      if (/\s/.test(char) && !depth) break
      cursor += 1
    }
    const href = clean.slice(start, cursor).replace(/\\([() ])/g, '$1')
    if (href) links.push({ href, index: match.index })
  }
  const references = new Map()
  for (const { label, href, index } of referenceDefinitions(clean)) {
    references.set(label, href)
    links.push({ href, index })
  }
  for (const match of clean.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const after = clean.slice(match.index + match[0].length)
    if (after.startsWith('(') || after.startsWith(':')) continue
    const label = normalizeReference(match[2] || match[1])
    if (match[2] !== undefined || references.has(label)) {
      links.push({ href: references.get(label), reference: label, index: match.index })
    }
  }
  return links
}

export function checkDocumentation(
  directory,
  { today = new Date().toISOString().slice(0, 10) } = {},
) {
  const root = realpathSync(directory)
  const findings = []
  const documents = new Map()
  const add = (file, rule, message, severity = 'error', line = 1) => {
    findings.push({ file, line, rule, severity, message })
  }
  const resolveLocal = (file) => {
    const resolved = path.resolve(root, file)
    return inside(root, resolved) && (!existsSync(resolved) || inside(root, realpathSync(resolved)))
      ? resolved
      : null
  }
  let policy
  try {
    policy = JSON.parse(readFileSync(path.join(root, 'docs-policy.json'), 'utf8'))
  } catch (error) {
    add('docs-policy.json', 'policy', `Cannot read policy: ${error.message}`)
    return { findings, documents: 0 }
  }
  const policyKeys = ['version', 'canonicalRoots', 'canonicalFiles', 'entrypoints', 'requiredFiles']
  if (!policy || Array.isArray(policy) || policy.version !== 1) {
    add('docs-policy.json', 'policy', 'Policy must be an object with version 1')
    return { findings, documents: 0 }
  }
  for (const key of Object.keys(policy)) {
    if (!policyKeys.includes(key)) add('docs-policy.json', 'policy', `Unknown key: ${key}`)
  }
  for (const key of policyKeys.slice(1)) {
    if (!Array.isArray(policy[key]) || policy[key].some((value) => typeof value !== 'string')) {
      add('docs-policy.json', 'policy', `${key} must be an array of repository paths`)
      return { findings, documents: 0 }
    }
    for (const file of policy[key]) {
      if (!file || path.isAbsolute(file) || !resolveLocal(file) || file.includes('\\')) {
        add('docs-policy.json', 'policy', `Invalid or escaping path: ${file}`)
      }
    }
  }
  if (!policy.canonicalRoots.length && !policy.canonicalFiles.length) {
    add('docs-policy.json', 'policy', 'At least one canonical root or file must be checked')
  }
  if (findings.length) return { findings, documents: 0 }

  const read = (file, canonical) => {
    const resolved = resolveLocal(file)
    if (!resolved || !existsSync(resolved) || !statSync(resolved).isFile()) {
      add(file, 'inventory', 'Required document is missing or escapes the repository')
      return
    }
    if (documents.has(file)) {
      if (canonical) documents.get(file).canonical = true
      return
    }
    const source = readFileSync(resolved, 'utf8')
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    const meta = {}
    if (match && canonical) {
      for (const line of match[1].split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const field = line.match(/^([a-z_]+):\s*(.*?)\s*$/)
        if (!field) {
          add(file, 'metadata', `Unsupported metadata syntax: ${line}`)
          continue
        }
        const [, key, raw] = field
        if (Object.hasOwn(meta, key)) add(file, 'metadata', `Duplicate field: ${key}`)
        if (!metadataKeys.has(key)) add(file, 'metadata', `Unknown field: ${key}`)
        try {
          meta[key] = raw.startsWith('[') || raw.startsWith('"') ? JSON.parse(raw) : raw
        } catch {
          add(file, 'metadata', `Invalid value for ${key}`)
        }
      }
    }
    const body = match ? blank(match[0]) + source.slice(match[0].length) : source
    documents.set(file, { canonical, source, body, meta })
    if (canonical && !match) add(file, 'metadata', 'Canonical Markdown requires frontmatter')
  }
  const walk = (file) => {
    const resolved = resolveLocal(file)
    if (!resolved || !existsSync(resolved) || !statSync(resolved).isDirectory()) {
      add(file, 'inventory', 'Canonical root is missing or invalid')
      return
    }
    for (const item of readdirSync(resolved, { withFileTypes: true })) {
      const child = `${file}/${item.name}`
      if (lstatSync(path.join(resolved, item.name)).isSymbolicLink()) {
        add(child, 'inventory', 'Canonical trees must not contain symlinks')
      } else if (item.isDirectory()) walk(child)
      else if (item.name.toLowerCase().endsWith('.md')) read(child, true)
    }
  }
  for (const file of policy.canonicalRoots) walk(file)
  for (const file of policy.canonicalFiles) read(file, true)
  for (const file of policy.entrypoints) read(file, false)
  for (const file of policy.requiredFiles) {
    if (!documents.get(file)?.canonical)
      add(file, 'inventory', 'Required canonical document is missing')
  }

  for (const [file, doc] of documents) {
    if (!doc.canonical) continue
    const { meta } = doc
    for (const key of ['doc_type', 'status', 'authority', 'last_reconciled']) {
      if (typeof meta[key] !== 'string' || !meta[key])
        add(file, 'metadata', `Missing or invalid ${key}`)
    }
    if (!Object.hasOwn(authorities, meta.doc_type)) add(file, 'metadata', 'Unknown document type')
    else if (authorities[meta.doc_type] !== meta.authority) {
      add(file, 'metadata', `${meta.doc_type} requires authority ${authorities[meta.doc_type]}`)
    }
    if (!statuses.has(meta.status)) add(file, 'lifecycle', 'Unknown lifecycle state')
    if (!validDate(meta.last_reconciled)) add(file, 'metadata', 'Invalid reconciliation date')
    else if (validDate(today) && Date.parse(meta.last_reconciled) > Date.parse(today) + 86400000) {
      add(file, 'metadata', 'Reconciliation date is in the future')
    }
    if (['active', 'completed'].includes(meta.status) && meta.doc_type !== 'plan') {
      add(file, 'lifecycle', 'Only a plan can be active or completed')
    }
    if (meta.doc_type === 'plan' && ['current', 'target'].includes(meta.status)) {
      add(
        file,
        'lifecycle',
        'A plan uses active/completed/historical, not current/target authority',
      )
    }
    if (meta.status === 'target' && !['contract', 'design'].includes(meta.doc_type)) {
      add(file, 'lifecycle', 'Only a contract or design can declare target behavior')
    }
    if (['contract', 'design'].includes(meta.doc_type)) {
      if (!implementations.has(meta.implementation))
        add(file, 'metadata', 'Invalid implementation state')
      if (!verifications.has(meta.verification_status))
        add(file, 'metadata', 'Invalid verification state')
      if (meta.status === 'current' && meta.implementation === 'retired') {
        add(file, 'lifecycle', 'A retired implementation cannot remain current')
      }
      if (meta.verification_status === 'verified' && !meta.verification_evidence?.length) {
        add(file, 'evidence', 'Verified scope requires verification_evidence paths')
      }
    }
    for (const key of relationships) {
      if (
        meta[key] !== undefined &&
        (!Array.isArray(meta[key]) || meta[key].some((v) => typeof v !== 'string'))
      ) {
        add(file, 'relationship', `${key} must be an inline array of repository paths`)
      }
    }
    if (meta.status === 'superseded' && !meta.superseded_by?.length) {
      add(file, 'relationship', 'Superseded documents require superseded_by')
    }
    if (meta.superseded_by !== undefined && meta.status !== 'superseded') {
      add(file, 'relationship', 'superseded_by requires superseded status')
    }
    if (
      meta.projection_of !== undefined &&
      (meta.doc_type !== 'guide' || meta.status !== 'current')
    ) {
      add(file, 'projection', 'Only a current guide can declare projection_of')
    }
  }

  for (const [file, doc] of documents) {
    if (!doc.canonical) continue
    for (const key of relationships) {
      if (!Array.isArray(doc.meta[key])) continue
      for (const target of doc.meta[key]) {
        if (typeof target !== 'string') continue
        const resolved = resolveLocal(target)
        if (!target || path.isAbsolute(target) || target.includes('\\') || !resolved) {
          add(file, 'relationship', `${key} escapes the repository: ${target}`)
          continue
        }
        const other = documents.get(target)
        if (!other?.canonical || target === file) {
          add(file, 'relationship', `${key} must name another canonical document: ${target}`)
          continue
        }
        if (key === 'verification_evidence') {
          if (!['evidence', 'plan'].includes(other.meta.doc_type)) {
            add(file, 'evidence', `Verification must link evidence or a plan: ${target}`)
          }
          if (other.meta.doc_type === 'plan' && other.meta.status !== 'completed') {
            add(file, 'evidence', `Verification plan must be completed: ${target}`)
          }
        } else if (key === 'projection_of') {
          if (
            other.meta.authority !== 'normative' ||
            other.meta.status !== 'current' ||
            !['contract', 'design'].includes(other.meta.doc_type)
          ) {
            add(
              file,
              'projection',
              `Projection source must be a current contract/design: ${target}`,
            )
          } else if (other.meta.last_reconciled > doc.meta.last_reconciled) {
            add(file, 'projection', `Review guide against later source: ${target}`, 'advisory')
          }
        } else {
          if (
            other.meta.doc_type !== doc.meta.doc_type ||
            other.meta.authority !== doc.meta.authority
          ) {
            add(
              file,
              'relationship',
              `Supersession must keep document type and authority: ${target}`,
            )
          }
          const reciprocal = key === 'supersedes' ? 'superseded_by' : 'supersedes'
          if (!Array.isArray(other.meta[reciprocal]) || !other.meta[reciprocal].includes(file)) {
            add(file, 'relationship', `Missing reciprocal ${reciprocal} in ${target}`)
          }
          if (key === 'supersedes' && other.meta.status !== 'superseded') {
            add(file, 'relationship', `Replaced document must be superseded: ${target}`)
          }
        }
      }
    }
    const visit = (target, seen) => {
      if (seen.has(target)) return true
      const next = documents.get(target)?.meta.superseded_by
      return Array.isArray(next) && next.some((value) => visit(value, new Set([...seen, target])))
    }
    if (visit(file, new Set())) add(file, 'relationship', 'Supersession cycle')
  }

  const anchorCache = new Map()
  for (const [file, doc] of documents) {
    const severity = doc.canonical && frozen.has(doc.meta.status) ? 'advisory' : 'error'
    for (const link of markdownLinks(doc.body)) {
      const line = doc.source.slice(0, link.index).split('\n').length
      if (link.href === undefined) {
        add(file, 'link', `Undefined reference: ${link.reference}`, severity, line)
        continue
      }
      if (/^file:/i.test(link.href)) {
        add(file, 'link', 'Local file URLs are not portable repository links', severity, line)
        continue
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link.href)) continue
      let href
      try {
        href = decodeURIComponent(link.href)
      } catch {
        add(file, 'link', `Invalid URL encoding: ${link.href}`, severity, line)
        continue
      }
      const [beforeFragment, fragment] = href.split('#', 2)
      const pathname = beforeFragment.split('?', 1)[0]
      const target = pathname ? path.posix.join(path.posix.dirname(file), pathname) : file
      const resolved = resolveLocal(target)
      if (path.isAbsolute(pathname) || pathname.includes('\\') || !resolved) {
        add(file, 'link', `Link escapes the repository: ${link.href}`, severity, line)
      } else if (!existsSync(resolved)) {
        add(file, 'link', `Missing local target: ${link.href}`, severity, line)
      } else if (fragment && /\.(?:md|html?)$/i.test(resolved)) {
        if (!anchorCache.has(resolved)) {
          const managed = documents.get(target)
          anchorCache.set(resolved, headingAnchors(managed?.body || readFileSync(resolved, 'utf8')))
        }
        if (!anchorCache.get(resolved).has(fragment)) {
          add(file, 'fragment', `Missing heading or HTML id: ${link.href}`, severity, line)
        }
      }
    }
  }
  const unique = [
    ...new Map(findings.map((finding) => [JSON.stringify(finding), finding])).values(),
  ]
  return { findings: unique, documents: documents.size }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDocumentation(process.cwd())
  for (const finding of result.findings) {
    console.log(
      `${finding.severity}: ${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`,
    )
  }
  const errors = result.findings.filter((finding) => finding.severity === 'error').length
  const advisories = result.findings.length - errors
  console.log(
    `Documentation: ${result.documents} files, ${errors} errors, ${advisories} advisories`,
  )
  process.exitCode = errors ? 1 : 0
}
