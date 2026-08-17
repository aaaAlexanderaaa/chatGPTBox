import { planChipVisible } from '../models/permission-model.mjs'

export function PlanChip({ plan, onTurnOff }) {
  if (!planChipVisible(plan)) return null
  return (
    <button
      type="button"
      className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary mb-1.5"
      title="Turn plan mode off"
      onClick={() => onTurnOff?.()}
    >
      Plan ×
    </button>
  )
}
