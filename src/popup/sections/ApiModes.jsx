import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import {
  apiModeToModelName,
  getApiModesFromConfig,
  isApiModeSelected,
  modelNameToDesc,
} from '../../utils/index.mjs'
import { CopyIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { useLayoutEffect, useState } from 'react'
import { SearchableSelect } from '../components/SearchableSelect.jsx'
import {
  AlwaysCustomGroups,
  CustomApiKeyGroups,
  CustomUrlGroups,
  ModelGroups,
  isModelDeprecated,
} from '../../config/index.mjs'

ApiModes.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

const defaultApiMode = {
  groupName: 'chatgptWebModelKeys',
  itemName: 'chatgptWeb51Thinking',
  isCustom: false,
  displayName: '',
  customName: '',
  customUrl: 'http://localhost:8000/v1/chat/completions',
  apiKey: '',
  active: true,
}

export function ApiModes({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [editingApiMode, setEditingApiMode] = useState(defaultApiMode)
  const [editingIndex, setEditingIndex] = useState(-1)
  const [apiModes, setApiModes] = useState([])
  const [apiModeStringArray, setApiModeStringArray] = useState([])

  useLayoutEffect(() => {
    const apiModes = getApiModesFromConfig(config)
    setApiModes(apiModes)
    setApiModeStringArray(apiModes.map(apiModeToModelName))
  }, [
    config.activeApiModes,
    config.customApiModes,
    config.azureDeploymentName,
    config.ollamaModelName,
  ])

  const enabledProviders = config.enabledProviders || {}
  const isProviderEnabled = (groupName) => enabledProviders[groupName] === true

  const getDefaultPresetItemName = (groupName) => {
    const items = ModelGroups[groupName].value || []
    if (config.showDeprecatedModels) return items[0]
    return items.find((itemName) => !isModelDeprecated(itemName)) || items[0]
  }

  const updateWhenApiModeDisabled = (apiMode) => {
    if (isApiModeSelected(apiMode, config))
      updateConfig({
        modelName:
          apiModeStringArray.includes(config.modelName) &&
          config.modelName !== apiModeToModelName(apiMode)
            ? config.modelName
            : 'customModel',
        apiMode: null,
      })
  }

  const editingComponent = (
    <div style={{ display: 'flex', flexDirection: 'column', '--spacing': '4px' }}>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={(e) => {
            e.preventDefault()
            setEditing(false)
          }}
        >
          {t('Cancel')}
        </button>
        <button
          onClick={(e) => {
            e.preventDefault()
            if (editingIndex === -1) {
              updateConfig({
                activeApiModes: [],
                customApiModes: [...apiModes, editingApiMode],
              })
            } else {
              const apiMode = apiModes[editingIndex]
              if (isApiModeSelected(apiMode, config)) updateConfig({ apiMode: editingApiMode })
              const customApiModes = [...apiModes]
              customApiModes[editingIndex] = editingApiMode
              updateConfig({ activeApiModes: [], customApiModes })
            }
            setEditing(false)
          }}
        >
          {t('Save')}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'noWrap' }}>
        {t('Type')}
        <SearchableSelect
          value={editingApiMode.groupName}
          onChange={(groupName) => {
            let itemName = getDefaultPresetItemName(groupName)
            const isCustom =
              editingApiMode.itemName === 'custom' && !AlwaysCustomGroups.includes(groupName)
            if (isCustom) itemName = 'custom'
            setEditingApiMode({ ...editingApiMode, groupName, itemName, isCustom })
          }}
          options={Object.entries(ModelGroups)
            .filter(
              ([groupName]) =>
                isProviderEnabled(groupName) || groupName === editingApiMode.groupName,
            )
            .map(([groupName, { desc }]) => ({
              value: groupName,
              label: t(desc),
            }))}
          minWidth="220px"
          searchPlaceholder={t('Search…')}
        />
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'noWrap' }}>
        {t('Mode')}
        <SearchableSelect
          value={editingApiMode.itemName}
          onChange={(nextValue) => {
            const groupName = editingApiMode.groupName
            const selectableItemNames = ModelGroups[groupName].value.filter((itemName) => {
              if (config.showDeprecatedModels) return true
              if (!isModelDeprecated(itemName)) return true
              return itemName === editingApiMode.itemName
            })

            if (nextValue === 'custom') {
              setEditingApiMode({ ...editingApiMode, itemName: 'custom', isCustom: true })
              return
            }

            if (selectableItemNames.includes(nextValue)) {
              setEditingApiMode({ ...editingApiMode, itemName: nextValue, isCustom: false })
              return
            }

            // Allow quickly creating a custom model entry by typing a model id and pressing Enter.
            if (!AlwaysCustomGroups.includes(groupName)) {
              setEditingApiMode({
                ...editingApiMode,
                itemName: 'custom',
                isCustom: true,
                customName: nextValue,
              })
            }
          }}
          options={[
            ...ModelGroups[editingApiMode.groupName].value
              .filter((itemName) => {
                if (config.showDeprecatedModels) return true
                if (!isModelDeprecated(itemName)) return true
                return itemName === editingApiMode.itemName
              })
              .map((itemName) => ({
                value: itemName,
                label: modelNameToDesc(itemName, t),
              })),
            ...(!AlwaysCustomGroups.includes(editingApiMode.groupName)
              ? [{ value: 'custom', label: t('Custom') }]
              : []),
          ]}
          minWidth="220px"
          allowCustomValue={!AlwaysCustomGroups.includes(editingApiMode.groupName)}
          searchPlaceholder={t('Search…')}
        />
        {(editingApiMode.isCustom || AlwaysCustomGroups.includes(editingApiMode.groupName)) && (
          <input
            type="text"
            value={editingApiMode.customName}
            placeholder={t('Model Name')}
            onChange={(e) => setEditingApiMode({ ...editingApiMode, customName: e.target.value })}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'noWrap' }}>
        {t('Display Name')}
        <input
          type="text"
          value={editingApiMode.displayName || ''}
          placeholder={t('Optional')}
          onChange={(e) => setEditingApiMode({ ...editingApiMode, displayName: e.target.value })}
        />
      </div>
      {CustomUrlGroups.includes(editingApiMode.groupName) &&
        (editingApiMode.isCustom || AlwaysCustomGroups.includes(editingApiMode.groupName)) && (
          <input
            type="text"
            value={editingApiMode.customUrl}
            placeholder={t('API Url')}
            onChange={(e) => setEditingApiMode({ ...editingApiMode, customUrl: e.target.value })}
          />
        )}
      {CustomApiKeyGroups.includes(editingApiMode.groupName) &&
        (editingApiMode.isCustom || AlwaysCustomGroups.includes(editingApiMode.groupName)) && (
          <input
            type="password"
            value={editingApiMode.apiKey}
            placeholder={t('API Key')}
            onChange={(e) => setEditingApiMode({ ...editingApiMode, apiKey: e.target.value })}
          />
        )}
    </div>
  )

  return (
    <>
      {apiModes.map((apiMode, index) => {
        if (!apiMode.groupName || !apiMode.itemName) return null
        const visible = isProviderEnabled(apiMode.groupName) || isApiModeSelected(apiMode, config)
        if (!visible) return null
        if (editing && editingIndex === index) return editingComponent
        return (
          <label key={index} style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={apiMode.active}
              onChange={(e) => {
                if (!e.target.checked) updateWhenApiModeDisabled(apiMode)
                const customApiModes = [...apiModes]
                customApiModes[index] = { ...apiMode, active: e.target.checked }
                updateConfig({ activeApiModes: [], customApiModes })
              }}
            />
            {apiMode.displayName?.trim()
              ? apiMode.displayName.trim()
              : modelNameToDesc(apiModeToModelName(apiMode), t)}
            <div style={{ flexGrow: 1 }} />
            <div style={{ display: 'flex', gap: '12px' }}>
              <div
                style={{ cursor: 'pointer' }}
                title={t('Clone')}
                onClick={(e) => {
                  e.preventDefault()
                  const original = apiModes[index]
                  const cloned = {
                    ...original,
                    displayName: original.displayName || '',
                    active: false,
                  }
                  const customApiModes = [...apiModes]
                  customApiModes.splice(index + 1, 0, cloned)
                  updateConfig({ activeApiModes: [], customApiModes })
                  setEditing(true)
                  setEditingApiMode(cloned)
                  setEditingIndex(index + 1)
                }}
              >
                <CopyIcon />
              </div>
              <div
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.preventDefault()
                  setEditing(true)
                  setEditingApiMode(apiMode)
                  setEditingIndex(index)
                }}
              >
                <PencilIcon />
              </div>
              <div
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.preventDefault()
                  updateWhenApiModeDisabled(apiMode)
                  const customApiModes = [...apiModes]
                  customApiModes.splice(index, 1)
                  updateConfig({ activeApiModes: [], customApiModes })
                }}
              >
                <TrashIcon />
              </div>
            </div>
          </label>
        )
      })}
      <div style={{ height: '30px' }} />
      {editing ? (
        editingIndex === -1 ? (
          editingComponent
        ) : undefined
      ) : (
        <button
          onClick={(e) => {
            e.preventDefault()
            setEditing(true)
            setEditingApiMode(defaultApiMode)
            setEditingIndex(-1)
          }}
        >
          {t('New')}
        </button>
      )}
    </>
  )
}
