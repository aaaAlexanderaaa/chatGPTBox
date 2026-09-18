// Shared engine-option list for every picker. The selectable unit is
// `{providerId}/{modelId}` from currently enabled L1/L2/L3 models.
import {
  applyEngineSelectionPatch,
  engineSelectionLabel,
  getSelectionString,
  isEnabledEngineSelection,
  listEnabledEngineSelections,
} from '../../config/engine-selection.mjs'

export function visibleApiModesForConfig(config, selectedModelName) {
  const selected = selectedModelName || getSelectionString(config)
  return listEnabledEngineSelections(config)
    .concat(
      selected && !isEnabledEngineSelection(selected, config)
        ? [
            {
              value: selected,
              providerId: selected.split('/')[0],
              modelId: selected.slice(selected.indexOf('/') + 1),
              providerName: '',
            },
          ]
        : [],
    )
    .map((item) => ({
      groupName: item.providerId,
      itemName: item.value,
      isCustom: false,
      displayName: item.value,
      customName: '',
      customUrl: '',
      apiKey: '',
      active: true,
      engineSelection: item.value,
    }))
}

export function buildEngineOptions(config, t, { selectedModelName } = {}) {
  const selected = selectedModelName || getSelectionString(config)
  const opts = listEnabledEngineSelections(config).map((item) => ({
    value: item.value,
    label: item.value,
    apiMode: null,
  }))

  if (selected && !opts.some((option) => option.value === selected)) {
    opts.unshift({
      value: selected,
      label: engineSelectionLabel(selected, t),
      apiMode: null,
    })
  }

  const deduped = []
  const seen = new Set()
  for (const option of opts) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    deduped.push(option)
  }
  return deduped
}

export function patchEngineSelection(selection) {
  return applyEngineSelectionPatch(selection)
}

export function modelNameToSelectLabel(modelName, _config, t) {
  return engineSelectionLabel(modelName, t)
}
