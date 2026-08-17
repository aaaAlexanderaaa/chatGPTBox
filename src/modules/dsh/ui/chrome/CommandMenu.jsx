import { useState } from 'preact/hooks'

export function CommandMenu({ sessionId, rpc, onInsert }) {
  const [open, setOpen] = useState(false)
  const [commands, setCommands] = useState([])
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setLoading(true)
    setOpen(true)
    try {
      const [commandResult, skillResult] = await Promise.all([
        rpc?.('command.list', { sessionId }),
        rpc?.('skill.list', { sessionId }),
      ])
      setCommands(commandResult?.commands || commandResult?.items || [])
      setSkills(skillResult?.skills || skillResult?.items || [])
    } catch {
      setCommands([])
      setSkills([])
    } finally {
      setLoading(false)
    }
  }

  const runCommand = (command) => {
    const line = command.line || `/${command.name}`
    void rpc?.('command.execute', { sessionId, line })
    setOpen(false)
  }

  const insertSkill = (skill) => {
    onInsert?.(`/${skill.name} `)
    setOpen(false)
  }

  return (
    <span className="relative mb-1.5">
      <button
        type="button"
        className="text-xs w-7 h-7 rounded-md border border-border hover:bg-secondary"
        title="Commands and skills"
        onClick={() => void toggle()}
      >
        +
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-20 min-w-[12rem] max-h-60 overflow-auto rounded-md border border-border bg-card shadow-md text-xs">
          {loading && <div className="px-2 py-1.5 text-muted-foreground">Loading…</div>}
          {!loading && commands.length === 0 && skills.length === 0 && (
            <div className="px-2 py-1.5 text-muted-foreground">No commands or skills</div>
          )}
          {commands.map((command) => (
            <button
              key={command.id || command.name || command.line}
              type="button"
              className="block w-full text-left px-2 py-1.5 hover:bg-secondary"
              onClick={() => runCommand(command)}
            >
              {command.title || command.name || command.line}
            </button>
          ))}
          {skills.length > 0 && commands.length > 0 && (
            <div className="border-t border-border my-0.5" />
          )}
          {skills.map((skill) => (
            <button
              key={skill.id || skill.name}
              type="button"
              className="block w-full text-left px-2 py-1.5 hover:bg-secondary"
              onClick={() => insertSkill(skill)}
            >
              /{skill.name}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
