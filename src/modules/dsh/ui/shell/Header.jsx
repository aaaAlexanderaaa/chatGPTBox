import { CircleDot } from 'lucide-react'

export function Header({ connection, waitingCount = 0, onOpenSettings, onWaitingClick }) {
  const online = connection?.status === 'online'
  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-border bg-card shrink-0">
      <span className="font-semibold text-sm">DeepSeek Harness</span>
      <CircleDot
        size={12}
        className={online ? 'text-emerald-500' : 'text-red-500'}
        aria-label={online ? 'online' : connection?.status || 'offline'}
      />
      <span className="text-xs text-muted-foreground truncate">
        {connection?.endpoint}
        {connection?.version ? ` · v${connection.version}` : ''}
      </span>
      {waitingCount > 0 && (
        <button
          type="button"
          className="ml-auto text-xs font-medium rounded-full px-3 py-1 border"
          style={{
            borderColor: 'var(--dsh-waiting-approval)',
            color: 'var(--dsh-waiting-approval)',
          }}
          onClick={() => onWaitingClick?.()}
        >
          {waitingCount} waiting for you
        </button>
      )}
      <button
        type="button"
        className={`text-xs text-muted-foreground hover:text-foreground ${
          waitingCount > 0 ? '' : 'ml-auto'
        }`}
        onClick={() => onOpenSettings?.()}
      >
        Settings
      </button>
    </header>
  )
}
