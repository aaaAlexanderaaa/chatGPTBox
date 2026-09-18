import PropTypes from 'prop-types'
import { getSettingsCards } from '../../modules/api.mjs'

export function DshEngineTab({ config, updateConfig }) {
  const Card = getSettingsCards().find((card) => card.id === 'dsh')?.Component
  if (!Card) return null
  return <Card config={config} updateConfig={updateConfig} hideEnableToggle />
}

DshEngineTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
