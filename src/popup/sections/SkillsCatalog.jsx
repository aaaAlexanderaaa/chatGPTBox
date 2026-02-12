import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import { useState } from 'react'
import { TrashIcon } from '@primer/octicons-react'
import { importSkillPackFromZipFile } from '../../services/skills/importer.mjs'

SkillsCatalog.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

function openFilePicker() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip'
    input.onchange = () => resolve(input.files?.[0] || null)
    input.click()
  })
}

export function SkillsCatalog({ config, updateConfig }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const skills = Array.isArray(config.installedSkills) ? config.installedSkills : []

  const onImport = async () => {
    try {
      setBusy(true)
      setErrorMessage('')
      const file = await openFilePicker()
      if (!file) return

      const importedSkill = await importSkillPackFromZipFile(file, skills)
      const duplicate = skills.find((skill) => skill.sourceHash === importedSkill.sourceHash)
      if (duplicate) {
        setErrorMessage(t('This skill package is already installed'))
        return
      }

      await updateConfig({
        installedSkills: [...skills, importedSkill],
      })
    } catch (error) {
      setErrorMessage(error?.message || t('Failed to import skill package'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="selection-tools-container">
      <div className="tools-section">
        <h3 className="section-title">
          {t('Skills')}
          <button
            className="button button-small button-primary add-tool-btn"
            onClick={onImport}
            disabled={busy}
          >
            {busy ? t('Importing...') : t('Import ZIP')}
          </button>
        </h3>

        {errorMessage && (
          <div className="error-message" role="alert" style={{ marginBottom: '10px' }}>
            {errorMessage}
          </div>
        )}

        <div className="hint-text" style={{ marginBottom: '10px' }}>
          {t('Install skills from ZIP packages that contain SKILL.md')}
        </div>

        <div className="custom-tools-list">
          {skills.length === 0 && <div className="hint-text">{t('No skills installed')}</div>}
          {skills.map((skill, index) =>
            skill?.name ? (
              <div key={skill.id || index} className="custom-tool-card">
                <div className="tool-card-header">
                  <label className="tool-checkbox-label">
                    <input
                      type="checkbox"
                      checked={skill.active !== false}
                      onChange={async (e) => {
                        const next = [...skills]
                        next[index] = { ...skill, active: e.target.checked }
                        await updateConfig({ installedSkills: next })
                      }}
                    />
                    <span className="tool-card-name">
                      {skill.name}
                      {skill.version ? ` (v${skill.version})` : ''}
                    </span>
                  </label>
                  <div className="tool-card-actions">
                    <button
                      className="icon-button icon-button-danger"
                      onClick={async () => {
                        const next = [...skills]
                        next.splice(index, 1)
                        await updateConfig({
                          installedSkills: next,
                          defaultSkillIds: (config.defaultSkillIds || []).filter(
                            (id) => id !== skill.id,
                          ),
                          assistants: (config.assistants || []).map((assistant) => ({
                            ...assistant,
                            defaultSkillIds: (assistant.defaultSkillIds || []).filter(
                              (id) => id !== skill.id,
                            ),
                          })),
                        })
                      }}
                      title={t('Remove')}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </div>
                <div className="tool-card-body">
                  <div className="tool-prompt" style={{ whiteSpace: 'pre-wrap' }}>
                    {skill.description || t('No description')}
                  </div>
                  <div className="hint-text" style={{ marginTop: '6px' }}>
                    {t('Source')}: {skill.sourceName || t('Unknown')} | {t('Entry')}:{' '}
                    {skill.entryPath}
                  </div>
                  <div className="hint-text">
                    {t('Resources')}: {(skill.resources || []).length}
                  </div>
                </div>
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  )
}
