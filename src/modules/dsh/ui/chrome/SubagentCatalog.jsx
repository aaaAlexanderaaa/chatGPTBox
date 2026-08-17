import { childSessions } from '../models/subagent-model.mjs'

export function SubagentCatalog({ parentSessionId, sessions, onOpen }) {
  const children = childSessions(parentSessionId, sessions)
  if (!children.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-muted-foreground">Subagents</span>
      {children.map((child) => (
        <button
          key={child.sessionId}
          type="button"
          className="px-2 py-0.5 rounded-md border border-border hover:bg-secondary truncate max-w-[10rem]"
          title={child.title || child.sessionId}
          onClick={() => onOpen?.(child.sessionId)}
        >
          {child.title || child.sessionId.slice(0, 8)}
        </button>
      ))}
    </div>
  )
}
