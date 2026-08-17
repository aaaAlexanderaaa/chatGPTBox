export function WorkspaceEmpty({ onAdd, pickerError }) {
  if (pickerError === 'directory-picker-unavailable') {
    return (
      <p className="dsh-empty">
        Native folder picking is unavailable on this host. Start `dsh` on a machine with a desktop
        picker.
      </p>
    )
  }
  return (
    <div className="dsh-empty">
      <p>Select a workspace folder to start.</p>
      <button type="button" onClick={() => onAdd?.()}>
        Add workspace
      </button>
    </div>
  )
}
