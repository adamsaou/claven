import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, iconForPath } from './Icons'
import { useSearch } from './useSearch'
import type { SearchMatch, SearchQuery } from '../../shared/search'

/**
 * Project search, in the sidebar.
 *
 * Deliberately not built on Picker. Picker is a modal overlay that owns its own
 * query, ranks a static array client-side and resets every time it opens. This
 * is a persistent panel over a stream that main ranks nothing about, and it has
 * to survive being switched away from. Reusing Picker would mean gutting the
 * parts quick-open and the palette depend on.
 *
 * Highlighted is not reused either: it renders one span per character, and a
 * 200-character preview across 200 rows is 40,000 spans. A hit is a single
 * range, so a row splits its preview into three pieces instead.
 */

type Props = {
  /**
   * Unsaved buffers, workspace-relative with forward slashes, so a search
   * answers about what is on screen rather than what was last written.
   */
  unsaved: Record<string, string>
  root: string | null
  onOpenHit: (file: string, line: number, column: number) => void
}

/** A row in the flattened list, so one selection index walks files and hits alike. */
type Row =
  | { kind: 'file'; file: string; count: number }
  | { kind: 'match'; file: string; match: SearchMatch }

function Toggle({
  label,
  title,
  active,
  onClick
}: {
  label: string
  title: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
        active ? 'border-ember text-ember' : 'border-line text-ink-dim hover:text-ink-muted'
      }`}
      style={{ borderRadius: 'var(--radius-xs)', transitionDuration: 'var(--dur-micro)' }}
    >
      {label}
    </button>
  )
}

export function SearchPanel({ root, unsaved, onOpenHit }: Props): React.JSX.Element {
  const [pattern, setPattern] = useState('')
  const [caseSensitive, setCaseSensitive] = useState<boolean | null>(null)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // Keyed on the paths and lengths rather than the object: the map is rebuilt
  // on every keystroke, and a new identity here restarts the search.
  const unsavedKey = Object.entries(unsaved)
    .map(([path, text]) => `${path}:${text.length}`)
    .join(',')
  const query: SearchQuery = useMemo(
    () => ({ pattern, caseSensitive, wholeWord, regex, unsaved }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pattern, caseSensitive, wholeWord, regex, unsavedKey]
  )
  const state = useSearch(query, root)

  const rows = useMemo<Row[]>(
    () =>
      state.groups.flatMap((group) => [
        { kind: 'file' as const, file: group.file, count: group.matches.length },
        ...group.matches.map((match) => ({ kind: 'match' as const, file: group.file, match }))
      ]),
    [state.groups]
  )

  useEffect(() => setSelected(0), [state.groups.length === 0])

  useEffect(() => {
    list.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const openRow = (row: Row | undefined): void => {
    if (row === undefined) return
    if (row.kind === 'file') onOpenHit(row.file, 1, 1)
    else onOpenHit(row.file, row.match.line, row.match.column)
  }

  const move = (delta: number): void => {
    setSelected((current) => {
      if (rows.length === 0) return 0
      return (current + delta + rows.length) % rows.length
    })
  }

  const footer = ((): string => {
    if (state.error !== null) return state.error
    if (root === null) return 'no folder open'
    if (pattern.length === 0) return ''
    if (state.running) return `searching, ${state.filesSearched.toLocaleString()} files`
    const done = state.done
    if (done === null) return ''
    const parts = [
      `${done.matchCount.toLocaleString()} ${done.matchCount === 1 ? 'match' : 'matches'} in ${state.groups.length} ${state.groups.length === 1 ? 'file' : 'files'}`,
      `${done.filesSearched.toLocaleString()} searched`,
      `${done.elapsedMs}ms`
    ]
    // Never silent about what was skipped. "12 results" is a lie if a third of
    // the tree was unreadable and nothing said so.
    if (done.reason === 'limit') parts.push(`stopped at the first ${done.matchCount.toLocaleString()}`)
    if (done.skipped.unreadable > 0) parts.push(`${done.skipped.unreadable} unreadable`)
    if (done.skipped.binary > 0) parts.push(`${done.skipped.binary} binary`)
    if (done.skipped.tooLarge > 0) parts.push(`${done.skipped.tooLarge} too large`)
    if (done.skipped.longLine > 0) parts.push(`${done.skipped.longLine} with long lines skipped`)
    if (done.crStripped) parts.push('cr ignored, searching normalised text')
    return parts.join(', ')
  })()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="border-line flex shrink-0 items-center border-b px-3"
        style={{ height: 'var(--titlebar-h)' }}
      >
        <span
          className="text-ink-dim truncate text-[10px] font-medium uppercase"
          style={{ letterSpacing: '0.14em' }}
        >
          search
        </span>
      </div>

      <input
        ref={input}
        value={pattern}
        onChange={(event) => setPattern(event.target.value)}
        onKeyDown={(event) => {
          /**
           * Stopped here, and this is a real bug being avoided rather than a
           * nicety. App listens for keys on `window` in the bubble phase, so
           * without this ctrl+w typed into this box closes your editor tab and
           * ctrl+b hides the panel you are typing into.
           */
          if (event.ctrlKey || event.metaKey) {
            if (['w', 'b', 'p', 'k', 'j'].includes(event.key.toLowerCase())) {
              event.stopPropagation()
            }
          }
          if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
            event.preventDefault()
            move(1)
          } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
            event.preventDefault()
            event.stopPropagation()
            move(-1)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            openRow(rows[selected])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            document.querySelector<HTMLElement>('.cm-content')?.focus()
          }
        }}
        placeholder="search the project"
        spellCheck={false}
        className="text-ink placeholder:text-ink-dim border-line shrink-0 border-b bg-transparent px-3 py-2 text-[13px] outline-none"
      />

      <div className="border-line flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5">
        <Toggle
          label="Aa"
          title={
            caseSensitive === null
              ? 'smart case: sensitive only if you type a capital'
              : caseSensitive
                ? 'case sensitive'
                : 'case insensitive'
          }
          active={caseSensitive === true}
          onClick={() => setCaseSensitive(caseSensitive === true ? null : true)}
        />
        <Toggle
          label="ab|"
          title="whole word"
          active={wholeWord}
          onClick={() => setWholeWord((value) => !value)}
        />
        <Toggle
          label=".*"
          title="regular expression"
          active={regex}
          onClick={() => setRegex((value) => !value)}
        />
      </div>

      <div ref={list} className="min-h-0 flex-1 overflow-auto py-1">
        {rows.map((row, index) => {
          const isSelected = index === selected
          if (row.kind === 'file') {
            const slash = row.file.lastIndexOf('/')
            const directory = slash === -1 ? '' : row.file.slice(0, slash + 1)
            const name = slash === -1 ? row.file : row.file.slice(slash + 1)
            return (
              <button
                key={`f:${row.file}`}
                data-selected={isSelected}
                onMouseMove={() => setSelected(index)}
                onClick={() => openRow(row)}
                title={row.file}
                className={`relative flex w-full items-center gap-1.5 py-[3px] pe-2 ps-2 text-start text-[12px] ${
                  isSelected ? 'bg-surface-2 text-ink' : 'text-ink-muted'
                }`}
              >
                {isSelected && <span className="bg-ember absolute inset-y-0 start-0 w-0.5" />}
                <Icon name={iconForPath(name)} size={13} className="shrink-0 opacity-80" />
                <span dir="auto" className="min-w-0 flex-1 truncate">
                  <span className="text-ink-dim">{directory}</span>
                  {name}
                </span>
                <span className="text-ink-dim shrink-0 tabular-nums">{row.count}</span>
              </button>
            )
          }

          // The hit split into three pieces rather than one span per character.
          const { match } = row
          const start = Math.max(0, match.column - 1 - match.previewFrom)
          const before = match.preview.slice(0, start)
          const hit = match.preview.slice(start, start + match.length)
          const after = match.preview.slice(start + match.length)
          return (
            <button
              key={`m:${row.file}:${match.line}:${match.column}`}
              data-selected={isSelected}
              onMouseMove={() => setSelected(index)}
              onClick={() => openRow(row)}
              className={`relative flex w-full items-baseline gap-2 py-[2px] pe-2 ps-6 text-start ${
                isSelected ? 'bg-surface-2' : ''
              }`}
            >
              {isSelected && <span className="bg-ember absolute inset-y-0 start-0 w-0.5" />}
              <span className="text-ink-dim w-8 shrink-0 text-end font-mono text-[10px] tabular-nums">
                {match.line}
              </span>
              <span className="text-ink-muted min-w-0 flex-1 truncate font-mono text-[11px]">
                {before}
                <span className="text-ember">{hit}</span>
                {after}
              </span>
            </button>
          )
        })}

        {!state.running && pattern.length > 0 && rows.length === 0 && state.error === null && (
          <p className="text-ink-dim px-3 py-2 text-xs">no matches</p>
        )}
      </div>

      {footer.length > 0 && (
        <div className="border-line text-ink-dim shrink-0 border-t px-3 py-1.5 text-[11px]">
          <span className={state.error !== null ? 'text-error' : ''}>{footer}</span>
        </div>
      )}
    </div>
  )
}
