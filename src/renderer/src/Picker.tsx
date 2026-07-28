import { useEffect, useMemo, useRef, useState } from 'react'
import { rank, type Match } from './fuzzy'

/**
 * The modal shell behind both the command palette and quick-open.
 *
 * Extracted rather than copied: they are the same overlay, input, filtered list
 * and keyboard model, and two copies would drift the moment one gets a fix.
 */

/** Highlights the characters the query actually matched. */
export function Highlighted({ text, match }: { text: string; match: Match }): React.JSX.Element {
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

type Props<T> = {
  open: boolean
  placeholder: string
  items: T[]
  /** Stable React key. */
  keyOf: (item: T) => string
  /** What the fuzzy matcher filters against. */
  searchOf: (item: T) => string
  renderRow: (item: T, match: Match, selected: boolean) => React.ReactNode
  onPick: (item: T) => void
  onClose: () => void
  emptyLabel?: string
  footer?: React.ReactNode
}

export function Picker<T>({
  open,
  placeholder,
  items,
  keyOf,
  searchOf,
  renderRow,
  onPick,
  onClose,
  emptyLabel = 'no matches',
  footer
}: Props<T>): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => rank(query, items, searchOf).slice(0, 200), [query, items, searchOf])

  // Reopening always starts clean — a picker that remembers your last query is
  // one you have to clear before every use.
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

  const commit = (): void => {
    const chosen = results[selected]?.item
    onClose()
    // After onClose so focus is back where it belongs before the action fires.
    if (chosen !== undefined) onPick(chosen)
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
      commit()
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
        className="border-line bg-surface-1 flex h-fit w-[min(38rem,90vw)] flex-col overflow-hidden border"
        style={{ borderRadius: 'var(--radius-md)' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          className="text-ink placeholder:text-ink-dim border-line border-b bg-transparent px-3 py-2.5 text-[13px] outline-none"
        />

        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="text-ink-dim px-3 py-2 text-[13px]">{emptyLabel}</li>
          )}
          {results.map(({ item, match }, index) => (
            <li key={keyOf(item)}>
              <button
                data-selected={index === selected}
                onMouseMove={() => setSelected(index)}
                onClick={commit}
                // `relative` is load-bearing. Rows draw the 2px ember rail with
                // an absolute span; without a positioned ancestor here it
                // resolved against the modal overlay instead and the scrolling
                // list clipped it away — accent that never once rendered.
                className={`relative flex w-full items-center gap-3 px-3 py-1.5 text-start text-[13px] transition-colors ${
                  index === selected ? 'bg-surface-2 text-ink' : 'text-ink-muted'
                }`}
                style={{ transitionDuration: 'var(--dur-micro)' }}
              >
                {renderRow(item, match, index === selected)}
              </button>
            </li>
          ))}
        </ul>

        {footer !== undefined && (
          <div className="border-line text-ink-dim border-t px-3 py-1.5 text-[11px]">{footer}</div>
        )}
      </div>
    </div>
  )
}
