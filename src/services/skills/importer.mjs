import { readZipEntries } from './zip-reader.mjs'

const textDecoder = new TextDecoder('utf-8')

function stripFrontMatter(markdown) {
  const text = String(markdown || '')
  if (!text.startsWith('---\n')) return { metadata: {}, content: text.trim() }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return { metadata: {}, content: text.trim() }
  const block = text.slice(4, end)
  const metadata = {}
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const split = line.indexOf(':')
    if (split === -1) continue
    const key = line.slice(0, split).trim()
    const value = line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) metadata[key] = value
  }
  return {
    metadata,
    content: text.slice(end + 5).trim(),
  }
}

function normalizePath(path) {
  const normalized = String(path || '')
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .trim()
  if (!normalized || normalized.startsWith('/')) return null
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '..')) return null
  return normalized
}

function dirname(path) {
  const index = path.lastIndexOf('/')
  if (index === -1) return ''
  return path.slice(0, index)
}

function resolveRelative(baseDir, value) {
  if (!value) return null
  const noAnchor = value.split('#')[0].trim()
  if (!noAnchor || noAnchor.includes('://') || noAnchor.startsWith('mailto:')) return null
  if (noAnchor.startsWith('/')) return null

  const base = baseDir ? `${baseDir}/${noAnchor}` : noAnchor
  const parts = []
  for (const chunk of base.split('/')) {
    if (!chunk || chunk === '.') continue
    if (chunk === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(chunk)
  }
  return parts.length > 0 ? parts.join('/') : null
}

function parseLinkedLocalFiles(markdown, skillPath) {
  const linked = new Set()
  const baseDir = dirname(skillPath)
  const patterns = [
    /\[[^\]]+\]\(([^)]+)\)/g, // markdown links
    /`([^`]+)`/g, // inline path snippets
  ]

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(markdown)) !== null) {
      const resolved = resolveRelative(baseDir, match[1])
      if (resolved) linked.add(resolved)
    }
  }

  return Array.from(linked)
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return toHex(new Uint8Array(digest))
}

function decodeText(bytes) {
  return textDecoder.decode(bytes)
}

function chooseSkillEntry(entries) {
  const exact = entries.find((entry) => entry.path === 'SKILL.md')
  if (exact) return exact
  return entries.find((entry) => entry.path.endsWith('/SKILL.md')) || null
}

function buildSkillId(name, hash, existingIds = new Set()) {
  const base = slugify(name) || 'skill'
  let id = `${base}-${hash.slice(0, 10)}`
  let suffix = 1
  while (existingIds.has(id)) {
    suffix += 1
    id = `${base}-${hash.slice(0, 10)}-${suffix}`
  }
  return id
}

function isLikelyTextFile(path) {
  return /\.(md|txt|json|ya?ml|toml|csv|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|sql|sh|bash|zsh)$/i.test(
    path,
  )
}

export async function parseSkillPackZip(arrayBuffer, sourceName = 'skill.zip') {
  const entries = await readZipEntries(arrayBuffer)
  const normalizedEntries = entries
    .map((entry) => ({ ...entry, path: normalizePath(entry.path) }))
    .filter((entry) => Boolean(entry.path))
  if (normalizedEntries.length === 0) {
    throw new Error('ZIP is empty')
  }

  const entryMap = new Map(normalizedEntries.map((entry) => [entry.path, entry]))
  const skillEntry = chooseSkillEntry(normalizedEntries)
  if (!skillEntry) {
    throw new Error('ZIP does not contain SKILL.md')
  }

  const skillMarkdown = decodeText(skillEntry.bytes)
  const { metadata, content } = stripFrontMatter(skillMarkdown)
  const instructions = content.trim()
  if (!instructions) {
    throw new Error('SKILL.md is empty')
  }

  const linkedFiles = parseLinkedLocalFiles(skillMarkdown, skillEntry.path)
  const resources = []
  for (const filePath of linkedFiles) {
    const entry = entryMap.get(filePath)
    if (!entry || !isLikelyTextFile(filePath)) continue
    const decoded = decodeText(entry.bytes).trim()
    if (!decoded) continue
    resources.push({ path: filePath, content: decoded.slice(0, 12000) })
    if (resources.length >= 12) break
  }

  return {
    metadata,
    sourceName,
    entryPath: skillEntry.path,
    instructions,
    resources,
  }
}

export async function importSkillPackFromZipFile(file, existingSkills = []) {
  if (!file) throw new Error('Skill package file is required')
  const isZip = String(file.name || '')
    .toLowerCase()
    .endsWith('.zip')
  if (!isZip) throw new Error('Only .zip skill packages are supported')
  if (Number(file.size) > 8 * 1024 * 1024) {
    throw new Error('Skill package is too large (max 8MB)')
  }

  const buffer = await file.arrayBuffer()
  const parsed = await parseSkillPackZip(buffer, file.name)
  const sourceHash = await sha256Hex(buffer)
  const name =
    String(parsed.metadata.name || '').trim() ||
    String(parsed.metadata.title || '').trim() ||
    file.name.replace(/\.zip$/i, '')
  if (!name) throw new Error('Skill name is required')

  const existingIds = new Set(
    (Array.isArray(existingSkills) ? existingSkills : [])
      .map((skill) => skill?.id)
      .filter((id) => typeof id === 'string' && id.trim()),
  )
  const id = buildSkillId(name, sourceHash, existingIds)

  return {
    id,
    name,
    description: String(parsed.metadata.description || '').trim(),
    version: String(parsed.metadata.version || '').trim(),
    sourceName: file.name,
    sourceHash,
    entryPath: parsed.entryPath,
    instructions: parsed.instructions,
    resources: parsed.resources,
    active: true,
    importedAt: Date.now(),
  }
}
