import '@picocss/pico'
import { useEffect, useState } from 'react'
import {
  defaultConfig,
  getPreferredLanguageKey,
  getUserConfig,
  setUserConfig,
} from '../config/index.mjs'
import { Tab, TabList, TabPanel, Tabs } from 'react-tabs'
import 'react-tabs/style/react-tabs.css'
import './styles.scss'
import { useWindowTheme } from '../hooks/use-window-theme.mjs'
import { isMobile } from '../utils/index.mjs'
import { useTranslation } from 'react-i18next'
import { GeneralPart } from './sections/GeneralPart'
import { FeaturePages } from './sections/FeaturePages'
import { AdvancedPart } from './sections/AdvancedPart'
import { ModulesPart } from './sections/ModulesPart'

function Popup() {
  const { t, i18n } = useTranslation()
  const [config, setConfig] = useState(defaultConfig)
  const [tabIndex, setTabIndex] = useState(0)
  const theme = useWindowTheme()

  const updateConfig = async (value) => {
    setConfig({ ...config, ...value })
    await setUserConfig(value)
  }

  useEffect(() => {
    getPreferredLanguageKey().then((lang) => {
      i18n.changeLanguage(lang)
    })
    getUserConfig().then((config) => {
      setConfig(config)
    })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = config.themeMode === 'auto' ? theme : config.themeMode
  }, [config.themeMode, theme])

  const search = new URLSearchParams(window.location.search)
  const popup = !isMobile() && search.get('popup') // manifest v2

  return (
    <div className={popup === 'true' ? 'container-popup-mode' : 'container-page-mode'}>
      <form style="width:100%;">
        <Tabs
          selectedTabClassName="popup-tab--selected"
          selectedIndex={tabIndex}
          onSelect={(index) => {
            setTabIndex(index)
          }}
        >
          <TabList>
            <Tab className="popup-tab">{t('General')}</Tab>
            <Tab className="popup-tab">{t('Feature Pages')}</Tab>
            <Tab className="popup-tab">{t('Modules')}</Tab>
            <Tab className="popup-tab">{t('Advanced')}</Tab>
          </TabList>

          <TabPanel>
            <GeneralPart config={config} updateConfig={updateConfig} setTabIndex={setTabIndex} />
          </TabPanel>
          <TabPanel>
            <FeaturePages config={config} updateConfig={updateConfig} />
          </TabPanel>
          <TabPanel>
            <ModulesPart config={config} updateConfig={updateConfig} />
          </TabPanel>
          <TabPanel>
            <AdvancedPart config={config} updateConfig={updateConfig} />
          </TabPanel>
        </Tabs>
      </form>
    </div>
  )
}

export default Popup
