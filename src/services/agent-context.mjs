import { RuntimeMode, isUsingChatgptWebModel } from '../config/index.mjs'
import { resolvePromptTemplate } from '../utils/prompt-template-context.mjs'

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function dedupeStringArray(value) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item) => typeof item === 'string' && item.trim())))
}

function normalizeSkillResource(resource) {
  if (!resource || typeof resource !== 'object') return null
  const path = normalizeString(resource.path).trim()
  const content = normalizeString(resource.content)
  if (!path || !content) return null
  return { path, content }
}

function normalizeSkill(skill) {
  if (!skill || typeof skill !== 'object') return null
  const id = normalizeString(skill.id)
  const name = normalizeString(skill.name)
  if (!id || !name) return null
  return {
    ...skill,
    id,
    name,
    description: normalizeString(skill.description),
    version: normalizeString(skill.version),
    sourceName: normalizeString(skill.sourceName),
    sourceHash: normalizeString(skill.sourceHash),
    entryPath: normalizeString(skill.entryPath || skill.mainPath),
    instructions: normalizeString(skill.instructions),
    resources: Array.isArray(skill.resources)
      ? skill.resources.map(normalizeSkillResource).filter(Boolean)
      : [],
    active: skill.active !== false,
    importedAt:
      Number.isFinite(skill.importedAt) && Number(skill.importedAt) > 0
        ? Number(skill.importedAt)
        : Date.now(),
  }
}

function normalizeMcpServer(server) {
  if (!server || typeof server !== 'object') return null
  const id = normalizeString(server.id)
  const name = normalizeString(server.name)
  if (!id || !name) return null
  const transport = normalizeString(server.transport).trim().toLowerCase() === 'builtin' ? 'builtin' : 'http'
  return {
    ...server,
    id,
    name,
    transport,
    httpUrl: transport === 'http' ? normalizeString(server.httpUrl) : '',
    apiKey: transport === 'http' ? normalizeString(server.apiKey) : '',
    active: server.active !== false,
  }
}

function normalizeAssistant(assistant) {
  if (!assistant || typeof assistant !== 'object') return null
  const id = normalizeString(assistant.id)
  const name = normalizeString(assistant.name)
  if (!id || !name) return null
  return {
    ...assistant,
    id,
    name,
    systemPrompt: normalizeString(assistant.systemPrompt),
    defaultSkillIds: dedupeStringArray(assistant.defaultSkillIds),
    defaultMcpServerIds: dedupeStringArray(assistant.defaultMcpServerIds),
    active: assistant.active !== false,
  }
}

export function getAssistants(config) {
  return (Array.isArray(config?.assistants) ? config.assistants : [])
    .map(normalizeAssistant)
    .filter(Boolean)
}

export function isAgentContextAllowedForSession(session) {
  return !isUsingChatgptWebModel(session || {})
}

export function getSkills(config) {
  return (Array.isArray(config?.installedSkills) ? config.installedSkills : [])
    .map(normalizeSkill)
    .filter(Boolean)
}

export function getMcpServers(config) {
  return (Array.isArray(config?.mcpServers) ? config.mcpServers : [])
    .map(normalizeMcpServer)
    .filter(Boolean)
}

export function resolveAssistant(session, config) {
  if (!isAgentContextAllowedForSession(session)) return null
  const assistants = getAssistants(config).filter((assistant) => assistant.active !== false)
  if (assistants.length === 0) return null
  if (typeof session?.assistantId === 'string') {
    const explicitId = session.assistantId.trim()
    if (!explicitId) return null
    return assistants.find((assistant) => assistant.id === explicitId) || null
  }

  const defaultId = normalizeString(config?.defaultAssistantId)
  if (defaultId) return assistants.find((assistant) => assistant.id === defaultId) || null
  return null
}

export function resolveSelectedSkillIds(session, config, assistant = null) {
  if (!isAgentContextAllowedForSession(session)) return []
  if (Array.isArray(session?.selectedSkillIds)) return dedupeStringArray(session.selectedSkillIds)
  if (assistant) {
    const assistantIds = dedupeStringArray(assistant.defaultSkillIds)
    if (assistantIds.length > 0) return assistantIds
  }
  return dedupeStringArray(config?.defaultSkillIds)
}

export function resolveSelectedMcpServerIds(session, config, assistant = null) {
  if (!isAgentContextAllowedForSession(session)) return []
  if (Array.isArray(session?.selectedMcpServerIds))
    return dedupeStringArray(session.selectedMcpServerIds)
  if (assistant) {
    const assistantIds = dedupeStringArray(assistant.defaultMcpServerIds)
    if (assistantIds.length > 0) return assistantIds
  }
  return dedupeStringArray(config?.defaultMcpServerIds)
}

export function getSelectedSkills(session, config) {
  const assistant = resolveAssistant(session, config)
  const ids = new Set(resolveSelectedSkillIds(session, config, assistant))
  return getSkills(config).filter((skill) => skill.active !== false && ids.has(skill.id))
}

export function getSelectedMcpServers(session, config) {
  const assistant = resolveAssistant(session, config)
  const ids = new Set(resolveSelectedMcpServerIds(session, config, assistant))
  return getMcpServers(config).filter((server) => server.active !== false && ids.has(server.id))
}

function summarizeSkill(skill) {
  const sections = []
  const heading = skill.version ? `${skill.name} (v${skill.version})` : skill.name
  sections.push(`- ${heading} [id: ${skill.id}]`)
  if (skill.description) sections.push(`  Description: ${skill.description}`)
  if (skill.sourceName) {
    sections.push(`  Source: ${skill.sourceName}`)
  }
  if (Array.isArray(skill.resources) && skill.resources.length > 0) {
    sections.push(`  Resource files: ${skill.resources.length}`)
  }
  return sections.join('\n')
}

function indentBlock(text, spaces = 2) {
  const prefix = ' '.repeat(Math.max(0, spaces))
  return String(text || '')
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function renderPromptTemplateWithPageContext(template, session, config) {
  return resolvePromptTemplate(template, {
    pageContext: session?.pageContext || null,
    preloadTokenCap: config?.agentPreloadContextTokenCap,
    contextTokenCap: config?.agentContextTokenCap,
    allowFullHtml: false,
  })
}

function summarizePageContext(pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return ''

  const lines = []
  const url = normalizeString(pageContext.url).trim()
  const title = normalizeString(pageContext.title).trim()
  const description = normalizeString(pageContext.description).trim()
  const language = normalizeString(pageContext.language).trim()

  if (url) lines.push(`- URL: ${url.slice(0, 280)}`)
  if (title) lines.push(`- Title: ${title.slice(0, 200)}`)
  if (description) lines.push(`- Description: ${description.slice(0, 260)}`)
  if (language) lines.push(`- Language: ${language.slice(0, 40)}`)

  const extraction = pageContext.extraction
  if (extraction && typeof extraction === 'object') {
    const method = normalizeString(extraction.method).trim()
    const selector = normalizeString(extraction.selector).trim()
    const matchedRule = normalizeString(extraction.matchedRule).trim()
    if (method) lines.push(`- Extraction method: ${method.slice(0, 80)}`)
    if (selector) lines.push(`- Extraction selector: ${selector.slice(0, 140)}`)
    if (matchedRule) lines.push(`- Extraction rule: ${matchedRule.slice(0, 80)}`)
  }

  const design = pageContext.design
  if (design && typeof design === 'object') {
    const viewport = normalizeString(design.viewport).trim()
    if (viewport) lines.push(`- Viewport: ${viewport.slice(0, 32)}`)

    const bodyBackgroundColor = normalizeString(design.bodyBackgroundColor).trim()
    const bodyTextColor = normalizeString(design.bodyTextColor).trim()
    if (bodyBackgroundColor) lines.push(`- Body background color: ${bodyBackgroundColor.slice(0, 64)}`)
    if (bodyTextColor) lines.push(`- Body text color: ${bodyTextColor.slice(0, 64)}`)

    if (Array.isArray(design.fonts) && design.fonts.length > 0) {
      const fonts = design.fonts
        .map((value) => normalizeString(value).trim())
        .filter(Boolean)
        .slice(0, 5)
      if (fonts.length > 0) lines.push(`- Fonts: ${fonts.join(', ')}`)
    }

    if (Array.isArray(design.palette) && design.palette.length > 0) {
      const palette = design.palette
        .map((value) => normalizeString(value).trim())
        .filter(Boolean)
        .slice(0, 8)
      if (palette.length > 0) lines.push(`- Color palette sample: ${palette.join(', ')}`)
    }

    if (Array.isArray(design.headingPreview) && design.headingPreview.length > 0) {
      const headingPreview = design.headingPreview
        .map((value) => normalizeString(value).trim())
        .filter(Boolean)
        .slice(0, 6)
      if (headingPreview.length > 0) {
        lines.push(`- Heading preview: ${headingPreview.join(' | ')}`)
      }
    }

    const countItems = [
      ['links', Number(design.linkCount)],
      ['buttons', Number(design.buttonCount)],
      ['images', Number(design.imageCount)],
      ['sections', Number(design.sectionCount)],
    ].filter(([, value]) => Number.isFinite(value) && value >= 0)
    if (countItems.length > 0) {
      lines.push(`- Element counts: ${countItems.map(([label, value]) => `${label}=${value}`).join(', ')}`)
    }
  }

  const content = normalizeString(pageContext.content).trim()
  if (content) {
    lines.push(`- Extracted page content snippet:\n${indentBlock(content.slice(0, 1800), 4)}`)
  }

  const styleSummary = normalizeString(pageContext.styleSummary).trim()
  if (styleSummary) {
    lines.push(`- Style summary:\n${indentBlock(styleSummary.slice(0, 2000), 4)}`)
  }

  const interactiveElements = normalizeString(pageContext.interactiveElements).trim()
  if (interactiveElements) {
    lines.push(`- Interactive elements:\n${indentBlock(interactiveElements.slice(0, 2200), 4)}`)
  }

  const domTree = normalizeString(pageContext.domTree).trim()
  if (domTree) {
    lines.push(`- DOM tree snapshot:\n${indentBlock(domTree.slice(0, 2600), 4)}`)
  }

  if (lines.length === 0) return ''
  return `Current webpage context captured from the active tab:\n${lines.join('\n')}`
}

export function buildSystemPromptFromContext(session, config, question = '') {
  if (!isAgentContextAllowedForSession(session)) return ''
  const assistant = resolveAssistant(session, config)
  const sections = []

  const systemPromptOverride = normalizeString(session?.systemPromptOverride).trim()
  const assistantPrompt = normalizeString(assistant?.systemPrompt).trim()
  if (systemPromptOverride) {
    sections.push(renderPromptTemplateWithPageContext(systemPromptOverride, session, config))
  } else if (assistantPrompt) {
    sections.push(renderPromptTemplateWithPageContext(assistantPrompt, session, config))
  }

  const skills = getSelectedSkills(session, config)
  if (skills.length > 0) {
    const skillText = skills.map((skill) => summarizeSkill(skill)).join('\n')
    sections.push(
      `Imported skills currently active (metadata only):\n${skillText}\n` +
        'Do not assume full skill instructions are preloaded. ' +
        'Use the built-in skill library tools to fetch skill details progressively only when needed.',
    )
  }

  const mcpServers = getSelectedMcpServers(session, config)
  if (mcpServers.length > 0) {
    const requestHint =
      typeof question === 'string' && question.trim()
        ? ` (current request: ${question.trim().slice(0, 160)})`
        : ''
    const lines = mcpServers.map((server) => {
      const location =
        server.transport === 'builtin' ? '(built-in)' : server.httpUrl || '(missing url)'
      return `- ${server.name} [${server.transport}] ${location}`
    })
    sections.push(
      `MCP servers are available for tool execution${requestHint}:\n${lines.join(
        '\n',
      )}\nUse MCP tools only when they are necessary for this user request.`,
    )
  }

  const hasAgentContext =
    Boolean(systemPromptOverride || assistantPrompt) || skills.length > 0 || mcpServers.length > 0
  if (hasAgentContext) {
    const pageContextSummary = summarizePageContext(session?.pageContext)
    if (pageContextSummary) sections.push(pageContextSummary)
  }

  if (config?.runtimeMode === RuntimeMode.developer) {
    sections.push('Runtime mode: developer.')
  }

  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function buildFallbackQuestionWithContext(question, session, config) {
  const baseQuestion = typeof question === 'string' ? question : ''
  const systemPrompt = buildSystemPromptFromContext(session, config, baseQuestion)
  if (!systemPrompt) return baseQuestion
  return (
    `Follow these instructions while answering:\n${systemPrompt}\n\n` +
    `User request:\n${baseQuestion}`
  )
}
