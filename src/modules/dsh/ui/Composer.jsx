import { useEffect, useRef, useState } from 'preact/hooks'
import { Paperclip, Send, Square, X } from 'lucide-react'

// Composer (ui-console.md): multiline auto-grow, queue/steer segmented
// control visible only while a turn runs, image attach (file/paste), stop
// button beside send while running, queue indicator with withdraw.
// Draft autosave: any blur/refresh keeps every keystroke (localStorage per
// session — the D-19 hard requirement, applied to the console too).

const draftKey = (sessionId) => `dsh-draft-${sessionId}`

async function fileToImageBlock(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  return {
    type: 'image',
    mediaType: file.type || 'image/png',
    data,
    name: file.name || 'image',
  }
}

export function Composer({ session, rpc, apiRef }) {
  const [text, setText] = useState('')
  const [images, setImages] = useState([])
  const [mode, setMode] = useState('queue') // queue | steer — steer exists only while running
  const [sending, setSending] = useState(false)
  const textareaRef = useRef(null)
  const running = session.running === true

  // Draft autosave (per session).
  useEffect(() => {
    try {
      setText(localStorage.getItem(draftKey(session.sessionId)) || '')
    } catch {
      setText('')
    }
    setImages([])
    setMode('queue')
  }, [session.sessionId])

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(session.sessionId), text)
      } catch {
        // private mode / quota — best effort
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [text, session.sessionId])

  // Auto-grow.
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [text])

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = { focus: () => textareaRef.current?.focus() }
    return () => {
      apiRef.current = null
    }
  }, [apiRef])

  const attachFiles = async (files) => {
    const blocks = await Promise.all(
      [...files].filter((file) => file.type.startsWith('image/')).map(fileToImageBlock),
    )
    if (blocks.length) setImages((prev) => [...prev, ...blocks])
  }

  const send = async () => {
    const content = []
    const trimmed = text.trim()
    if (!trimmed && images.length === 0) return
    if (trimmed) content.push({ type: 'text', text: trimmed })
    for (const image of images) content.push(image)
    setSending(true)
    try {
      await rpc('session.prompt', {
        sessionId: session.sessionId,
        mode: running ? mode : 'queue',
        content,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      setText('')
      setImages([])
      try {
        localStorage.removeItem(draftKey(session.sessionId))
      } catch {
        // best effort
      }
    } catch {
      // failure keeps the draft — never lose user input
    } finally {
      setSending(false)
    }
  }

  const stop = () => void rpc('session.cancel', { sessionId: session.sessionId })

  return (
    <div className="border-t border-border bg-card px-4 py-2.5 shrink-0">
      {session.queueItems?.length > 0 && (
        <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground">
          <span>⧗ {session.queueItems.length} queued</span>
          {session.queueItems.map((item) => (
            <span key={item.id} className="flex items-center gap-1 bg-secondary rounded-full px-2 py-0.5 max-w-60">
              <span className="truncate">{item.text || 'queued prompt'}</span>
              <button
                title="Withdraw"
                onClick={() => void rpc('session.queue-remove', { sessionId: session.sessionId, itemId: item.id })}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="flex gap-2 mb-1.5">
          {images.map((image, index) => (
            <span key={index} className="relative">
              <img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} className="h-14 rounded border border-border object-cover" />
              <button
                className="absolute -top-1.5 -right-1.5 bg-secondary rounded-full p-0.5"
                onClick={() => setImages((prev) => prev.filter((_, i2) => i2 !== index))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="text-muted-foreground hover:text-foreground cursor-pointer pb-2" title="Attach image">
          <Paperclip size={15} />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(event) => void attachFiles(event.target.files || [])}
          />
        </label>
        <textarea
          ref={textareaRef}
          className="flex-1 bg-transparent text-sm resize-none outline-none py-2 max-h-[200px] placeholder:text-muted-foreground"
          rows={1}
          placeholder={session.blank ? 'Describe the task — e.g. "fix the failing build in ~/repo and open a PR"…' : 'Reply, queue the next step, or steer…'}
          value={text}
          onInput={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void send()
            }
          }}
          onPaste={(event) => {
            const files = [...(event.clipboardData?.files || [])]
            if (files.length) {
              event.preventDefault()
              void attachFiles(files)
            }
          }}
        />
        {running && (
          <div className="flex rounded-md border border-border overflow-hidden text-xs mb-1.5">
            {['queue', 'steer'].map((value) => (
              <button
                key={value}
                className={`px-2 py-1 ${mode === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
                onClick={() => setMode(value)}
                title={value === 'queue' ? 'Run after the current turn finishes' : 'Steer the running turn immediately'}
              >
                {value}
              </button>
            ))}
          </div>
        )}
        <button
          className={`text-xs px-3 py-1.5 rounded-md mb-1.5 flex items-center gap-1.5 ${
            text.trim() || images.length ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
          }`}
          disabled={sending || (!text.trim() && images.length === 0)}
          onClick={() => void send()}
          title="Send (⌘↩)"
        >
          <Send size={13} />
          {running ? 'Queue' : 'Send'}
        </button>
        {running && (
          <button
            className="text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-secondary mb-1.5 flex items-center gap-1"
            onClick={stop}
            title="Stop the running turn (session.cancel)"
          >
            <Square size={12} className="text-red-500" /> Stop
          </button>
        )}
      </div>
    </div>
  )
}
