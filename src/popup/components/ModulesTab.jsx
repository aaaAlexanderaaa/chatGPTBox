import PropTypes from 'prop-types'
import { SelectionTools } from '../sections/SelectionTools.jsx'

/**
 * ModulesTab - selection tools only; sites and extractor moved to the Sites
 * tab (C3), API modes to Engines (C2). This tab dissolves in C4.
 */
export function ModulesTab({ config, updateConfig }) {
  return (
    <div className="modules-legacy">
      <SelectionTools config={config} updateConfig={updateConfig} />
    </div>
  )
}

ModulesTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
