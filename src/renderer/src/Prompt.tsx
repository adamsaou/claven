import { useEffect, useRef, useState } from 'react'

export type PromptRequest = {
  title: string
  initial: string
  /** Characters to preselect, so renaming a file does not select its extension. */
  selectTo?: number
  confirmLabel: string
  onConfirm: (value: string) => void
}

type Props = {
  request: PromptRequest | null
  onClose: () => void
}

/**
 * Text input modal. Electron has no native prompt dialog, and `window.prompt`
 * is disabled in the renderer, so this is the only way to ask for a filename.
 */
export function Prompt({ request, onClose }: Props): React.JSX.Element | null {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (request === null) return
    setValue(request.initial)
    // Defer so the input exists before selecting inside it.
    queueMicrotask(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(0, request.selectTo ?? request.initial.length)
    })
  }, [request])

  if (request === null) return null

  const submit = (): void => {
    const trimmed = value.trim()
    onClose()
    if (trimmed.length > 0 && trimmed !== request.initial) request.onConfirm(trimmed)
  }

  return (
    <div
      className="absolute inset-0 z-50 flex justify-center"
      style={{ background: 'rgba(15, 17, 21, 0.5)', paddingTop: '18vh' }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={request.title}
        className="border-line bg-surface-1 flex h-fit w-[min(28rem,90vw)] flex-col gap-3 border p-4"
        style={{ borderRadius: 'var(--radius-md)' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="text-ink-muted text-[13px]">{request.title}</label>
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          dir="auto"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          className="border-line text-ink bg-surface-2 border px-2 py-1.5 text-[13px] outline-none focus:outline-1 focus:outline-offset-[-1px] focus:outline-[color:var(--color-ember)]"
          style={{ borderRadius: 'var(--radius-xs)' }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="border-line text-ink-muted hover:text-ink border px-3 py-1 text-[12px]"
            style={{ borderRadius: 'var(--radius-xs)' }}
          >
            cancel
          </button>
          <button
            onClick={submit}
            className="border-ember text-ember hover:bg-ember hover:text-obsidian border px-3 py-1 text-[12px] transition-colors"
            style={{ borderRadius: 'var(--radius-xs)', transitionDuration: 'var(--dur-micro)' }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
