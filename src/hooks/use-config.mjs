import { useEffect, useState } from 'react'
import { defaultConfig, getUserConfig } from '../config/storage.mjs'
import Browser from 'webextension-polyfill'

export function useConfig(initFn, ignoreSession = true) {
  const [config, setConfig] = useState(defaultConfig)
  useEffect(() => {
    getUserConfig().then((config) => {
      setConfig(config)
      if (initFn) initFn()
    })
  }, [])
  useEffect(() => {
    const listener = (changes) => {
      if (ignoreSession) if (Object.keys(changes).length === 1 && 'sessions' in changes) return

      // History bodies and other runtime records share storage.local with
      // settings. Retaining them here duplicates the entire backup in every
      // mounted consumer (including content scripts in other tabs).
      const changedItems = Object.keys(changes).filter(
        (key) => Object.hasOwn(defaultConfig, key) || (!ignoreSession && key === 'sessions'),
      )
      if (!changedItems.length) return
      const newConfig = {}
      for (const key of changedItems) {
        newConfig[key] =
          changes[key].newValue === undefined ? defaultConfig[key] : changes[key].newValue
      }
      setConfig((prev) => ({ ...prev, ...newConfig }))
    }
    Browser.storage.local.onChanged.addListener(listener)
    return () => {
      Browser.storage.local.onChanged.removeListener(listener)
    }
  }, [ignoreSession])
  return config
}
