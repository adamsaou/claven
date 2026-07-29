import { useCallback, useEffect, useRef, useState } from 'react'
import { TerminalView } from './TerminalView'
import { Icon } from '../Icons'

/**
 * The terminal panel: its tabs, its height, and the shells inside it.
 *
 * Every terminal stays mounted for as long as its tab exists. Switching tabs
 * hides one and shows another rather than tearing anything down, because a
 * terminal you have to restart is not a terminal you would keep a long-running
 * process in.
 */

const MIN_HEIGHT = 120
const MAX_HEIGHT = 900
const HEIGHT_KEY = 'claven.terminal.height'

type Props = {
  open: boolean
  onClose: () => void
}

export function TerminalDock({ open, onClose }: Props): React.JSX.Element {
  /**
   * Local keys, not the pty ids. A view asks main for its shell after it
   * mounts, so the id does not exist yet at the moment a tab is created, and
   * keying the list on something that arrives later would mean rendering a tab
   * with no identity.
   */
  const [terminals, setTerminals] = useState<string[]>(['terminal-1'])
  const [active, setActive] = useState('terminal-1')
  const nextKey = useRef(2)

  const [height, setHeight] = useState(() => {
    const stored = Number(localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(stored) && stored >= MIN_HEIGHT ? stored : 240
  })
  const dragging = useRef(false)
  const dock = useRef<HTMLDivElement>(null)

  useEffect(() => localStorage.setItem(HEIGHT_KEY, String(height)), [height])

  const addTerminal = useCallback(() => {
    const key = `terminal-${nextKey.current++}`
    setTerminals((current) => [...current, key])
    setActive(key)
  }, [])

  const closeTerminal = useCallback(
    (key: string) => {
      setTerminals((current) => {
        const index = current.indexOf(key)
        const next = current.filter((candidate) => candidate !== key)
        // Closing the last one closes the panel rather than leaving an empty
        // dock with a header and nothing under it.
        if (next.length === 0) {
          onClose()
          // Reset, so reopening starts a fresh shell instead of restoring a
          // panel whose only tab was just closed.
          nextKey.current = 1
          const fresh = `terminal-${nextKey.current++}`
          setActive(fresh)
          return [fresh]
        }
        setActive((currentActive) =>
          currentActive === key ? (next[Math.min(index, next.length - 1)] ?? next[0]!) : currentActive
        )
        return next
      })
    },
    [onClose]
  )

  /** Drag the top edge. Upwards makes it taller, which is why the sign flips. */
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      if (!dragging.current || dock.current === null) return
      const bottom = dock.current.getBoundingClientRect().bottom
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, bottom - event.clientY)))
    }
    const onUp = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div
      ref={dock}
      className="border-line bg-obsidian relative shrink-0 border-t"
      style={{ height: open ? `${height}px` : 0, overflow: 'hidden' }}
    >
      {/* Grab area straddling the border, matching the sidebar's handle. */}
      <div
        onMouseDown={() => {
          dragging.current = true
          document.body.style.cursor = 'row-resize'
          document.body.style.userSelect = 'none'
        }}
        onDoubleClick={() => setHeight(240)}
        title="drag to resize · double-click to reset"
        className="hover:bg-ember/40 absolute inset-x-0 -top-0.5 z-10 h-1 cursor-row-resize transition-colors"
        style={{ transitionDuration: 'var(--dur-micro)' }}
      />

      <div
        className="border-line bg-surface-1 flex items-stretch border-b"
        style={{ height: 'var(--statusbar-h)' }}
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {terminals.map((key, index) => {
            const isActive = key === active
            return (
              <div
                key={key}
                className={`group border-line relative flex shrink-0 items-center gap-2 border-e ps-3 pe-2 transition-colors ${
                  isActive ? 'bg-obsidian text-ink' : 'text-ink-dim hover:bg-surface-2'
                }`}
                style={{ transitionDuration: 'var(--dur-micro)' }}
              >
                {/* Same 2px ember rail as an editor tab, so the two strips
                    agree about what "this one is focused" looks like. */}
                {isActive && <span className="bg-ember absolute inset-x-0 top-0 h-0.5" />}
                <button
                  onClick={() => setActive(key)}
                  className="flex items-center gap-1.5 text-[11px] font-medium"
                >
                  <Icon name="terminal" size={12} className="shrink-0 opacity-80" />
                  <span>{index + 1}</span>
                </button>
                <button
                  onClick={() => closeTerminal(key)}
                  aria-label={`close terminal ${index + 1}`}
                  className="text-ink-dim hover:text-ink flex h-4 w-4 shrink-0 items-center justify-center text-xs"
                >
                  ×
                </button>
              </div>
            )
          })}
          <button
            onClick={addTerminal}
            aria-label="new terminal"
            title="new terminal"
            className="text-ink-dim hover:text-ink shrink-0 px-3 text-sm transition-colors"
            style={{ transitionDuration: 'var(--dur-micro)' }}
          >
            +
          </button>
        </div>

        <button
          onClick={onClose}
          aria-label="hide terminal"
          className="text-ink-dim hover:text-ink shrink-0 px-3 text-xs transition-colors"
          style={{ transitionDuration: 'var(--dur-micro)' }}
        >
          ×
        </button>
      </div>

      <div className="relative" style={{ height: `calc(100% - var(--statusbar-h))` }}>
        {terminals.map((key) => (
          <div
            key={key}
            // Hidden rather than unmounted. Unmounting kills the shell, and a
            // shell that dies when you glance at another tab is useless for
            // anything that takes more than a second.
            className="absolute inset-0"
            style={{ visibility: key === active && open ? 'visible' : 'hidden' }}
          >
            <TerminalView visible={key === active && open} onExit={() => closeTerminal(key)} />
          </div>
        ))}
      </div>
    </div>
  )
}
