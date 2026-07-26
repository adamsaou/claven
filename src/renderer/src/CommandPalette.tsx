import { useEffect, useMemo, useRef, useState } from 'react'
import { rank, type Match } from './fuzzy'

export type Command = {
  id: string
  /** Lowercase, terse, verb first — per BRAND.md voice. */
  title: string
  /** Rendered right-aligned. Display only; the real binding lives in the keymap. */
  keys?: string
  enabled?: boolean
  run: () => void
}

type Props = {
  open: boolean
  commands: Command[]
  onClose: () => void
}

/** Highlights the characters the query actually matched. */
function Highlighted({ text, match }: { text: string; match: Match }): React.JSX.Element {
  if (match.positions.length === 0) return <>{text}</>
  const hit = new Set(match.positions)
  return (
    <>
      {Array.from(text).map((char, index) =>
        hit.has(index) ? (
          <span key={index} className="text-ember">
            {char}
          </span>
        ) : (
          <span key={index}>{char}</span>
        )
      )}
    </>
  )
}

export function CommandPalette({ open, commands, onClose }: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const available = useMemo(() => commands.filter((c) => c.enabled !== false), [commands])
  const results = useMemo(() => rank(query, available, (c) => c.title), [query, available])

  // Reopening always starts clean — a palette that remembers your last query is
  // a palette you have to clear before every use.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      inputRef.current?.focus()
    }
  }, [open])

  useEffect(() => setSelected(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  const runSelected = (): void => {
    const chosen = results[selected]?.item
    onClose()
    // After onClose so focus is back where it belongs before the command fires.
    chosen?.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      setSelected((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      setSelected((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runSelected()
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex justify-center"
      // Scrim, not a shadow — BRAND.md forbids shadows in product chrome.
      style={{ background: 'rgba(15, 17, 21, 0.5)', paddingTop: '12vh' }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="command palette"
        className="border-line bg-surface-1 flex h-fit w-[min(36rem,90vw)] flex-col overflow-hidden border"
        style={{ borderRadius: 'var(--radius-md)' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="type a command"
          spellCheck={false}
          className="text-ink placeholder:text-ink-dim border-line border-b bg-transparent px-3 py-2.5 text-[13px] outline-none"
        />

        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="text-ink-dim px-3 py-2 text-[13px]">no matching command</li>
          )}
          {results.map(({ item, match }, index) => (
            <li key={item.id}>
              <button
                data-selected={index === selected}
                onMouseMove={() => setSelected(index)}
                onClick={runSelected}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-start text-[13px] transition-colors ${
                  index === selected ? 'bg-surface-2 text-ink' : 'text-ink-muted'
                }`}
                style={{ transitionDuration: 'var(--dur-micro)' }}
              >
                <span className="relative flex-1 truncate">
                  {index === selected && (
                    <span className="bg-ember absolute inset-y-0 -start-3 w-0.5" />
                  )}
                  <Highlighted text={item.title} match={match} />
                </span>
                {item.keys !== undefined && (
                  <span className="text-ink-dim shrink-0 font-mono text-[11px]">{item.keys}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
