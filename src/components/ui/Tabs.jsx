import { useState } from 'preact/hooks'
import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

/**
 * Tabs component
 * Matches the demo design system
 */
function Tabs({ tabs, activeTab: controlledActiveTab, defaultActiveTab, onChange, className }) {
  const [internalActiveTab, setInternalActiveTab] = useState(defaultActiveTab || tabs[0]?.id)

  // Support both controlled and uncontrolled modes
  const isControlled = controlledActiveTab !== undefined
  const activeTab = isControlled ? controlledActiveTab : internalActiveTab

  const handleTabClick = (tabId) => {
    if (!isControlled) {
      setInternalActiveTab(tabId)
    }
    if (onChange) {
      onChange(tabId)
    }
  }

  return (
    <div className={cn('flex gap-1 p-1 bg-secondary/50 rounded-lg', className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabClick(tab.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-all',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {tab.label && <span className="hidden sm:inline">{tab.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

Tabs.propTypes = {
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string,
      icon: PropTypes.elementType,
    }),
  ).isRequired,
  activeTab: PropTypes.string,
  defaultActiveTab: PropTypes.string,
  onChange: PropTypes.func,
  className: PropTypes.string,
}

/**
 * TabPanel component - renders content for active tab
 */
function TabPanel({ children, tabId, activeTab, className }) {
  if (tabId !== activeTab) return null

  return <div className={cn('animate-fade-in', className)}>{children}</div>
}

TabPanel.propTypes = {
  children: PropTypes.node,
  tabId: PropTypes.string.isRequired,
  activeTab: PropTypes.string.isRequired,
  className: PropTypes.string,
}

export { Tabs, TabPanel }
