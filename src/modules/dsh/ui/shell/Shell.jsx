export function Shell({ header, sidebar, children }) {
  return (
    <div className="dsh-app">
      {header}
      <div className="flex flex-1 min-h-0">
        {sidebar}
        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
      </div>
    </div>
  )
}
