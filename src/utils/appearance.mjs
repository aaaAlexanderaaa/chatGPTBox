/**
 * Accent (bubble / highlight) theme tokens.
 * Dark values match `frontend_redesign/app/page.tsx` highlight themes.
 * Light values follow the base light theme approach (muted accents).
 */
const ACCENT_COLOR_THEMES = {
  teal: { hue: 180, chromaDark: 0.14, lightnessDark: 0.72 },
  blue: { hue: 250, chromaDark: 0.15, lightnessDark: 0.65 },
  purple: { hue: 300, chromaDark: 0.15, lightnessDark: 0.65 },
  green: { hue: 150, chromaDark: 0.15, lightnessDark: 0.7 },
  orange: { hue: 45, chromaDark: 0.15, lightnessDark: 0.72 },
  rose: { hue: 25, chromaDark: 0.2, lightnessDark: 0.65 },
}

// Light theme is intentionally "muted"; calibrated from teal (0.10 / 0.14).
const LIGHT_THEME_LIGHTNESS = 0.5
const LIGHT_THEME_CHROMA_RATIO = 0.1 / 0.14

const ACCENT_STRENGTHS = {
  soft: {
    chromaMultiplier: 0.85,
    lightnessDelta: { light: 0.06, dark: -0.03 },
  },
  normal: {
    chromaMultiplier: 1,
    lightnessDelta: { light: 0, dark: 0 },
  },
  vivid: {
    chromaMultiplier: 1.2,
    lightnessDelta: { light: -0.06, dark: 0.03 },
  },
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function getAccentOklch({ theme, color, strength }) {
  const base = ACCENT_COLOR_THEMES[color] || ACCENT_COLOR_THEMES.teal
  const profile = ACCENT_STRENGTHS[strength] || ACCENT_STRENGTHS.normal

  const baseLightness = theme === 'light' ? LIGHT_THEME_LIGHTNESS : base.lightnessDark
  const baseChroma =
    theme === 'light' ? base.chromaDark * LIGHT_THEME_CHROMA_RATIO : base.chromaDark

  const lightness = clamp(baseLightness + (profile.lightnessDelta[theme] ?? 0), 0.35, 0.85)
  const chroma = clamp(baseChroma * profile.chromaMultiplier, 0.02, 0.22)

  return `oklch(${lightness} ${chroma} ${base.hue})`
}

// From frontend_redesign/components/conversation-preview.tsx (codeThemeStyles)
export const CODE_THEME_STYLES = {
  'github-dark': {
    bg: '#0d1117',
    text: '#c9d1d9',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    comment: '#8b949e',
    function: '#d2a8ff',
  },
  'github-light': {
    bg: '#f6f8fa',
    text: '#24292f',
    keyword: '#cf222e',
    string: '#0a3069',
    comment: '#6e7781',
    function: '#8250df',
  },
  monokai: {
    bg: '#272822',
    text: '#f8f8f2',
    keyword: '#f92672',
    string: '#e6db74',
    comment: '#75715e',
    function: '#a6e22e',
  },
  dracula: {
    bg: '#282a36',
    text: '#f8f8f2',
    keyword: '#ff79c6',
    string: '#f1fa8c',
    comment: '#6272a4',
    function: '#50fa7b',
  },
  nord: {
    bg: '#2e3440',
    text: '#d8dee9',
    keyword: '#81a1c1',
    string: '#a3be8c',
    comment: '#616e88',
    function: '#88c0d0',
  },
}

export function getCodeThemeVars(codeTheme) {
  const theme = CODE_THEME_STYLES[codeTheme] || CODE_THEME_STYLES['github-dark']
  return {
    '--code-bg': theme.bg,
    '--code-text': theme.text,
    '--code-keyword': theme.keyword,
    '--code-string': theme.string,
    '--code-comment': theme.comment,
    '--code-function': theme.function,
  }
}

export function getAccentVars(config, resolvedTheme) {
  const color = resolvedTheme === 'light' ? config.accentColorLight : config.accentColorDark
  const strength =
    resolvedTheme === 'light' ? config.accentStrengthLight : config.accentStrengthDark
  const oklch = getAccentOklch({ theme: resolvedTheme, color, strength })
  return {
    '--primary': oklch,
    '--ring': oklch,
  }
}

export function getResolvedCodeTheme(config, resolvedTheme) {
  if (resolvedTheme === 'light') return config.codeThemeLight || 'github-light'
  return config.codeThemeDark || 'github-dark'
}

export function applyCssVars(element, vars) {
  if (!element) return
  for (const [key, value] of Object.entries(vars)) {
    element.style.setProperty(key, value)
  }
}

const CHATGPTBOX_ROOT_SELECTOR = [
  '.chatgptbox-container',
  '#chatgptbox-container',
  '.chatgptbox-selection-window',
  '.chatgptbox-toolbar-container',
  '.chatgptbox-toolbar-container-not-queryable',
  '.chatgptbox-selection-toolbar',
].join(',')

export function applyChatGptBoxAppearance(rootElement, config, resolvedTheme) {
  if (!rootElement) return

  const targets = new Set()
  if (rootElement.matches && rootElement.matches(CHATGPTBOX_ROOT_SELECTOR)) targets.add(rootElement)
  if (rootElement.querySelectorAll)
    rootElement.querySelectorAll(CHATGPTBOX_ROOT_SELECTOR).forEach((el) => targets.add(el))

  const accentVars = getAccentVars(config, resolvedTheme)
  const codeTheme = getResolvedCodeTheme(config, resolvedTheme)
  const codeVars = getCodeThemeVars(codeTheme)

  for (const el of targets) {
    if (el.dataset) el.dataset.theme = resolvedTheme
    applyCssVars(el, accentVars)
    applyCssVars(el, codeVars)
  }
}

export function applyDocumentAppearance(documentElement, config, resolvedTheme) {
  if (!documentElement) return
  const accentVars = getAccentVars(config, resolvedTheme)
  applyCssVars(documentElement, accentVars)
  // Keep sidebar tokens in sync for redesigned UI components
  applyCssVars(documentElement, {
    '--sidebar-primary': accentVars['--primary'],
    '--sidebar-ring': accentVars['--ring'],
  })
}
