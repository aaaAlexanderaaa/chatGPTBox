export function pickerPresets(list) {
  return (list?.presets || []).filter((preset) => !preset.broken)
}

export function presetLabel(preset) {
  return preset?.name || preset?.id || ''
}

export function defaultPresetId(list) {
  const rows = pickerPresets(list)
  return rows.find((preset) => preset.isDefault)?.id || rows[0]?.id || null
}

export function isPresetLocked(session) {
  return session?.blank !== true
}
