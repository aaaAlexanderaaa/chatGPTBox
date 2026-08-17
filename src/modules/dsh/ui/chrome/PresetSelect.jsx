import { isPresetLocked, pickerPresets, presetLabel } from '../models/preset-model.mjs'

export function PresetSelect({ list, session, value, onChange }) {
  const options = pickerPresets(list)
  const locked = isPresetLocked(session)
  if (options.length === 0) return null
  return (
    <label className="dsh-preset">
      <select
        disabled={locked}
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {options.map((preset) => (
          <option key={preset.id} value={preset.id} title={preset.description || ''}>
            {presetLabel(preset)}
          </option>
        ))}
      </select>
      {options.find((preset) => preset.id === value)?.description ? (
        <span className="dsh-preset-desc">
          {options.find((preset) => preset.id === value).description}
        </span>
      ) : null}
    </label>
  )
}
