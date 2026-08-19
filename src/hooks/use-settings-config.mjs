import { useEffect, useState } from 'preact/hooks'
import { defaultConfig, getUserConfig, setUserConfig } from '../config/storage.mjs'
import { useWindowTheme } from './use-window-theme.mjs'
import { applyDocumentAppearance } from '../utils/appearance.mjs'

/**
 * Shared state for the settings surfaces (popup quick settings and the
 * options settings center): load once, update locally + persist.
 */
export function useSettingsConfig() {
  const [config, setConfig] = useState(defaultConfig)

  useEffect(() => {
    getUserConfig().then(setConfig)
  }, [])

  // Functional setState avoids stale-closure merges
  const updateConfig = async (value) => {
    setConfig((prev) => ({ ...prev, ...value }))
    await setUserConfig(value)
  }

  return [config, updateConfig]
}

/**
 * Resolve themeMode against the system preference and apply theme + accent
 * + code-theme variables to the document.
 */
export function useApplyAppearance(config) {
  const windowTheme = useWindowTheme()
  const resolvedTheme = config.themeMode === 'auto' ? windowTheme : config.themeMode

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    applyDocumentAppearance(document.documentElement, config, resolvedTheme)
  }, [
    resolvedTheme,
    config.accentColorLight,
    config.accentStrengthLight,
    config.accentColorDark,
    config.accentStrengthDark,
  ])

  return resolvedTheme
}
