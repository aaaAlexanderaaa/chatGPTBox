export function normalizeLanguageKey(value = 'en') {
  const key = String(value || 'en')
    .replace(/_/g, '-')
    .toLowerCase()
  if (/^zh(?:hant|-(?:hant|tw|hk|mo|cht))(?:-|$)/.test(key)) return 'zhHant'
  if (key.startsWith('zh')) return 'zh'
  if (key === 'id' || key.startsWith('id-')) return 'in'
  return key.split('-')[0] || 'en'
}

export function preferredLanguageKey(config, fallback = 'en') {
  return normalizeLanguageKey(
    config.preferredLanguage && config.preferredLanguage !== 'auto'
      ? config.preferredLanguage
      : config.userLanguage || fallback,
  )
}
