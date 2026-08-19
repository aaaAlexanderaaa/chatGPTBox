import PropTypes from 'prop-types'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SegmentedControl } from './ui/SegmentedControl.jsx'
import { ThemeMode } from '../config/constants.mjs'

/**
 * ThemeSwitcher - the single light/auto/dark control shared by the settings
 * appearance section and the conversation page header.
 */
export function ThemeSwitcher({ value, onChange, showLabels = true, size = 'default' }) {
  const { t } = useTranslation()

  const options = [
    { value: 'light', icon: Sun, label: t(ThemeMode.light) },
    { value: 'auto', icon: Monitor, label: t(ThemeMode.auto) },
    { value: 'dark', icon: Moon, label: t(ThemeMode.dark) },
  ]

  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={onChange}
      showLabels={showLabels}
      size={size}
      ariaLabel={t('Theme')}
    />
  )
}

ThemeSwitcher.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  showLabels: PropTypes.bool,
  size: PropTypes.oneOf(['default', 'sm']),
}
