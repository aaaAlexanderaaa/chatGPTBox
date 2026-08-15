import { useEffect, useRef, useState } from 'preact/hooks'
import { GitBranch, Pencil } from 'lucide-react'

// Session bar: title (rename), model chip, auto-approve switch (D-8: at
// hand, explicit, in view at all times, default off), fork.

export function SessionBar({ session, rpc }) {
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [models, setModels] = useState(null)
  const titleRef = useRef(null)

  useEffect(() => {
    setModels(null)
  }, [session.sessionId])

  useEffect(() => {
    if (editing) titleRef.current?.focus()
  }, [editing])

  const loadModels = async () => {
    if (models) return
    try {
      setModels(await rpc('session.models', { sessionId: session.sessionId }))
    } catch {
      setModels({ groups: [], failures: [] })
    }
  }

  const commitTitle = () => {
    setEditing(false)
    const title = titleDraft.trim()
    if (title && title !== session.title) void rpc('session.rename', { sessionId: session.sessionId, title })
  }

  const modelOptions = (models?.groups || []).flatMap((group) =>
    (group.models || []).map((model) => ({ ...model, groupName: group.name })),
  )
  const currentModel =
    models?.current ? `${models.current.provider}/${models.current.model}` : 'model'

  return (
    <div className="flex items-center gap-2 h-11 px-4 border-b border-border shrink-0">
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
          className="text-sm font-medium truncate max-w-sm flex items-center gap-1.5 hover:text-primary"
          title="Rename"
          onClick={() => {
            setTitleDraft(session.title || '')
            setEditing(true)
          }}
        >
          {session.title || (session.blank ? 'New session' : session.sessionId)}
          <Pencil size={12} className="opacity-50" />
        </button>
      )}

      <div className="relative">
        <button
          className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary text-muted-foreground"
          onClick={loadModels}
        >
          {currentModel} ▾
        </button>
        {models && (
          <div className="absolute top-full left-0 mt-1 z-10 max-h-72 w-72 overflow-auto bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1">
            {modelOptions.map((model) => (
              <button
                key={`${models.current?.provider}/${model.id}`}
                className="block w-full text-left text-xs px-3 py-1.5 hover:bg-secondary"
                onClick={() => {
                  void rpc('session.selectModel', {
                    sessionId: session.sessionId,
                    provider: models.current?.provider,
                    model: model.id,
                  })
                  setModels(null)
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

      <label
        className="ml-auto flex items-center gap-2 text-xs cursor-pointer select-none"
        title="Auto-approve every decision in this session (default off — the agent never steps past an approval without you)"
      >
        <span className={session.autoApprove ? 'text-foreground font-medium' : 'text-muted-foreground'}>
          auto-approve
        </span>
        <input
          type="checkbox"
          checked={session.autoApprove === true}
          onChange={(event) =>
            void rpc('autoApprove.set', { sessionId: session.sessionId, value: event.target.checked })
          }
        />
      </label>

      <button
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        title="Fork at the last completed turn"
        onClick={() =>
          void rpc('session.fork', { sessionId: session.sessionId }).then(
            (value) => value?.sessionId,
            () => null,
          )
        }
      >
        <GitBranch size={13} /> fork
      </button>
    </div>
  )
}
