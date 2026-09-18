import { useEffect, useRef, useState } from 'preact/hooks'
import { GitBranch, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { modelsFromCatalog, modelChipLabel, selectModelArgs } from '../select-model.mjs'
import { JobsPopover } from '../chrome/JobsPopover.jsx'
import { SubagentCatalog } from '../chrome/SubagentCatalog.jsx'

// Session chrome: title (rename), model chip, auto-approve switch, fork.

export function SessionHeader({ session, rpc, onSelect, sessions }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [models, setModels] = useState(null)
  const [picked, setPicked] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const titleRef = useRef(null)

  useEffect(() => {
    setModels(null)
    setPicked(null)
    setMenuOpen(false)
    void rpc('session.models', { sessionId: session.sessionId }).then(setModels, () =>
      setModels({ groups: [], failures: [] }),
    )
  }, [session.sessionId, rpc])

  useEffect(() => {
    if (editing) titleRef.current?.focus()
  }, [editing])

  const commitTitle = () => {
    setEditing(false)
    const title = titleDraft.trim()
    if (title && title !== session.title)
      void rpc('session.rename', { sessionId: session.sessionId, title })
  }

  const modelOptions = modelsFromCatalog(models)
  const currentModel = modelChipLabel(models, picked)

  return (
    <div className="flex flex-wrap items-center gap-2 min-h-11 px-4 border-b border-border shrink-0">
      {editing ? (
        <input
          ref={titleRef}
          className="text-sm bg-transparent border-b border-primary outline-none flex-1 max-w-sm"
          value={titleDraft}
          onInput={(event) => setTitleDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitTitle()
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="text-sm font-medium truncate max-w-sm flex items-center gap-1.5 hover:text-primary"
          title={t('Rename')}
          onClick={() => {
            setTitleDraft(session.title || '')
            setEditing(true)
          }}
        >
          {session.title || (session.blank ? t('New session') : session.sessionId)}
          <Pencil size={12} className="opacity-50" />
        </button>
      )}

      <div className="relative">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary text-muted-foreground"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {currentModel} ▾
        </button>
        {menuOpen && models && (
          <div className="absolute top-full left-0 mt-1 z-10 max-h-72 w-72 overflow-auto bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1">
            {modelOptions.map((model) => (
              <button
                key={`${model.provider || models.current?.provider}/${model.id}`}
                type="button"
                className="block w-full text-left text-xs px-3 py-1.5 hover:bg-secondary"
                onClick={() => {
                  const args = selectModelArgs(session.sessionId, model, models.current?.provider)
                  setPicked({ provider: args.provider, id: model.id })
                  setMenuOpen(false)
                  void rpc('session.selectModel', args)
                }}
                title={model.description || model.name}
              >
                <span className="text-[10px] text-muted-foreground mr-1">{model.groupName}</span>
                {model.name}
              </button>
            ))}
            {(models.failures || []).map((failure) => (
              <p key={failure.id} className="text-[11px] text-red-500 px-3 py-1">
                {failure.name}: {failure.message}
              </p>
            ))}
          </div>
        )}
      </div>

      <JobsPopover jobs={session.jobs} />
      <SubagentCatalog
        parentSessionId={session.sessionId}
        sessions={sessions || []}
        onOpen={onSelect}
      />

      <label
        className="ml-auto flex items-center gap-2 text-xs cursor-pointer select-none"
        title={t(
          'Auto-approve every decision in this session (default off — the agent never steps past an approval without you)',
        )}
      >
        <span
          className={session.autoApprove ? 'text-foreground font-medium' : 'text-muted-foreground'}
        >
          {t('auto-approve')}
        </span>
        <input
          type="checkbox"
          checked={session.autoApprove === true}
          onChange={(event) =>
            void rpc('autoApprove.set', {
              sessionId: session.sessionId,
              value: event.target.checked,
            })
          }
        />
      </label>

      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        title={t('Fork at the last completed turn')}
        onClick={() =>
          void rpc('session.fork', { sessionId: session.sessionId }).then(
            (value) => {
              if (value?.sessionId) onSelect?.(value.sessionId)
            },
            () => null,
          )
        }
      >
        <GitBranch size={13} /> {t('fork')}
      </button>
    </div>
  )
}
