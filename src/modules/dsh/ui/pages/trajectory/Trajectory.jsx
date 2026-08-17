function asRows(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    if (Array.isArray(value.rows)) return value.rows
    if (Array.isArray(value.entries)) return value.entries
    return Object.entries(value).map(([key, entry]) =>
      entry && typeof entry === 'object' ? { key, ...entry } : { key, value: entry },
    )
  }
  return []
}

function cellText(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function Trajectory({ session }) {
  const trajectory = session?.projections?.trajectory
  const tokenUsage = session?.projections?.tokenUsage
  const rows = asRows(trajectory?.length || trajectory ? trajectory : tokenUsage)
  const keys =
    rows.length > 0
      ? [
          ...new Set(
            rows.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : [])),
          ),
        ]
      : []

  return (
    <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
      <h2 className="text-sm font-medium mb-2">Trajectory</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No trajectory rows yet.</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              {keys.map((key) => (
                <th key={key} className="py-1 pr-3 font-medium">
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-border/60 align-top">
                {keys.map((key) => (
                  <td key={key} className="py-1 pr-3 font-mono whitespace-pre-wrap break-all">
                    {cellText(row?.[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tokenUsage && trajectory && (
        <pre className="mt-3 text-[11px] bg-secondary rounded-md p-2 overflow-auto">
          {cellText(tokenUsage)}
        </pre>
      )}
    </div>
  )
}
