// Shared engine-option list for every picker (default-engine selector in
// General, per-site engine rules in Sites). Extracted from GeneralTab when
// the per-site picker (roadmap C3) needed the identical list, including the
// enabled-provider gating and deprecated-model filtering.
import { apiModeToModelName, getApiModesFromConfig, modelNameToDesc } from '../../utils/index.mjs'
import { isModelDeprecated } from '../../config/models.mjs'

function modelNameToSelectLabel(modelName, config, t) {
  if (modelName === 'customModel') return modelNameToDesc(modelName, t, config.customModelName)
  if (modelName.startsWith('azureOpenAi-') && modelName.endsWith('-'))
    return modelNameToDesc('azureOpenAi', t)
  if (modelName.startsWith('ollama-') && modelName.endsWith('-'))
    return modelNameToDesc('ollama', t)
  return modelNameToDesc(modelName, t)
}

/**
 * Build the selectable engine list from config.
 *
 * @param {object} config
 * @param {(key: string, opts?: object) => string} t
 * @param {{ selectedModelName?: string }} [options] - keep the given
 *   selection visible even when its provider is disabled/deprecated
 * @returns {Array<{ value: string, label: string, apiMode: object|null }>}
 */
export function buildEngineOptions(config, t, { selectedModelName } = {}) {
  const selected = selectedModelName || (config.apiMode ? apiModeToModelName(config.apiMode) : config.modelName)
  const apiModes = getApiModesFromConfig(config, true).filter((apiMode) => {
    if (!apiMode || !apiMode.groupName) return false
    const modelName = apiModeToModelName(apiMode)
    const isSelected = modelName === selected
    const providerEnabled = config.enabledProviders?.[apiMode.groupName] === true
    if (!providerEnabled && !isSelected) return false
    if (!config.showDeprecatedModels && !isSelected && isModelDeprecated(modelName)) return false
    return true
  })

  const opts = apiModes
    .map((apiMode) => {
      const modelName = apiModeToModelName(apiMode)
      if (!modelName) return null
      const displayName = apiMode.displayName?.trim()
      return {
        value: modelName,
        label: displayName ? displayName : modelNameToSelectLabel(modelName, config, t),
        apiMode,
      }
    })
    .filter(Boolean)

  opts.push({
    value: 'customModel',
    label: modelNameToSelectLabel('customModel', config, t),
    apiMode: null,
  })

  if (selected && !opts.some((o) => o.value === selected)) {
    opts.unshift({
      value: selected,
      label: modelNameToSelectLabel(selected, config, t),
      apiMode: config.apiMode && apiModeToModelName(config.apiMode) === selected ? config.apiMode : null,
    })
  }

  const deduped = []
  const seen = new Set()
  for (const opt of opts) {
    if (seen.has(opt.value)) continue
    seen.add(opt.value)
    deduped.push(opt)
  }
  return deduped
}

export { modelNameToSelectLabel }
