import { useEffect, useState } from 'preact/hooks'
import { defaultConfig, getUserConfig, setUserConfig } from '../config/storage.mjs'
import { useWindowTheme } from './use-window-theme.mjs'
import { applyDocumentAppearance } from '../utils/appearance.mjs'
import Browser from 'webextension-polyfill'

/**
 * Shared state for the settings surfaces (popup quick settings and the
 * options settings center): load once, update locally + persist.
 */
export function useSettingsConfig() {
  const [config, setConfig] = useState(defaultConfig)
  const [readState, setReadState] = useState('loading')

  useEffect(() => {
    let loading = true,
      disposed = false
    const received = {}
    const changed = (changes) => {
      const patch = Object.fromEntries(
        Object.entries(changes)
          .filter(([key]) => key in defaultConfig && key !== 'sessions')
          .map(([key, value]) => [
            key,
            // A null paste policy is malformed, not an empty/default policy.
            key === 'chatgptNativePasteTerms' && value.newValue !== undefined
              ? value.newValue
              : value.newValue ?? defaultConfig[key],
          ]),
      )
      if (Object.keys(patch).length) {
        if (loading) Object.assign(received, patch)
        setConfig((previous) => ({ ...previous, ...patch }))
      }
    }
    Browser.storage.local.onChanged.addListener(changed)
    getUserConfig()
      .then((value) => {
        if (disposed) return
        loading = false
        setConfig({ ...value, ...received })
        setReadState('ready')
      })
      .catch(() => {
        if (disposed) return
        loading = false
        setReadState('error')
      })
    return () => {
      disposed = true
      Browser.storage.local.onChanged.removeListener(changed)
    }
  }, [])

  // Functional setState avoids stale-closure merges
  const updateConfig = async (value) => {
    if (Object.hasOwn(value, 'chatgptNativePasteTerms')) {
      if (readState !== 'ready')
        throw new Error('Saved rules are unavailable. Reload settings before saving.')
      // Active paste policy comes only from successful storage events. A failed
      // write must not promote the draft or survive as optimistic settings state.
      await setUserConfig(value)
      return
    }
    if (
      ['browserAssistantFunctions', 'browserFunctionOverrides', 'customSelectionTools'].some(
        (key) => Object.hasOwn(value, key),
      )
    ) {
      await setUserConfig(value)
      setConfig((prev) => ({ ...prev, ...value }))
      return
    }
    setConfig((prev) => ({ ...prev, ...value }))
    await setUserConfig(value)
  }

  return [config, updateConfig, readState]
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
