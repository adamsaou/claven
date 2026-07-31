import { useCallback, useMemo, useState } from 'react'
import {
  activateTerminal,
  addTerminal,
  defaultLayout,
  editorPane,
  moveTerminal,
  nextId,
  panes,
  parseLayout,
  removeTerminal,
  seedIds,
  splitPane,
  stripTerminalPanes,
  terminalKeys,
  type Edge,
  type LayoutNode
} from '../../../shared/layout'

/**
 * Layout state.
 *
 * Persisted through the session file rather than localStorage, which is where
 * this started. localStorage is a renderer-side store that Chromium flushes to
 * disk on its own schedule, so killing the process loses whatever was written
 * in the last few seconds. The drive suite caught it: the window came back
 * from a `SIGKILL` with its unsaved edits restored and its panes gone. The
 * session file is written through on every change, and the layout belongs with
 * the open tabs anyway.
 */

export type TerminalSlot = { key: string; paneId: string; visible: boolean }

export function useLayout(): {
  layout: LayoutNode
  /** What to draw. Differs from `layout` only while terminals are hidden. */
  visible: LayoutNode
  setLayout: (next: LayoutNode) => void
  editorPaneId: string | null
  terminalOrder: string[]
  terminalSlots: TerminalSlot[]
  hasTerminals: boolean
  toggleTerminals: () => void
  addTerminalTo: (paneId: string) => void
  closeTerminal: (key: string) => void
  activate: (key: string) => void
  move: (key: string, target: { paneId: string; edge: Edge | 'center' }) => void
  reset: () => void
  /** Called once, with whatever the session held. Ignores anything unusable. */
  restore: (stored: LayoutNode | null) => void
} {
  const [layout, setLayout] = useState<LayoutNode>(defaultLayout)
  const [hidden, setHidden] = useState(false)

  const restore = useCallback((stored: LayoutNode | null) => {
    const parsed = parseLayout(stored)
    if (parsed === null) return
    // The ids came back with it, so the counter has to clear them before
    // anything new is created against the same tree.
    seedIds(parsed)
    setLayout(parsed)
  }, [])

  const visible = useMemo(() => (hidden ? stripTerminalPanes(layout) : layout), [layout, hidden])

  /**
   * Sorted by key, which is creation order, and deliberately not by position in
   * the tree.
   *
   * The surface layer's whole premise is a list that never reorders. Ordering
   * it by the layout breaks that the first time you drag something: React
   * reorders the keyed children, which is a DOM move, and moving an xterm
   * detaches and reattaches it. Measured consequence, before this was sorted:
   * the terminal arrived in the new pane with its scrollback intact, looking
   * perfectly healthy, and silently stopped accepting input. Keystrokes piled
   * up in its hidden textarea and were never read.
   *
   * Sorting by key makes the order depend only on which terminals exist, so a
   * drag changes four numbers on a style attribute and nothing else. Numbering
   * follows the same order, so a terminal keeps its label when it moves.
   */
  const terminalOrder = useMemo(
    () => [...terminalKeys(layout)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [layout]
  )

  const terminalSlots = useMemo(() => {
    const slots = panes(layout).flatMap((pane) =>
      pane.content.type === 'terminals'
        ? pane.content.terminals.map((key) => ({
            key,
            paneId: pane.id,
            // Hidden terminals stay mounted and lose their rect, which parks
            // them off screen with the shell still running.
            visible: !hidden && key === (pane.content as { active: string }).active
          }))
        : []
    )
    return slots.sort((a, b) => terminalOrder.indexOf(a.key) - terminalOrder.indexOf(b.key))
  }, [layout, hidden, terminalOrder])

  const addTerminalTo = useCallback((paneId: string) => {
    setLayout((current) => addTerminal(current, paneId, nextId('terminal')))
    setHidden(false)
  }, [])

  const closeTerminal = useCallback((key: string) => {
    setLayout((current) => removeTerminal(current, key))
  }, [])

  const activate = useCallback((key: string) => {
    setLayout((current) => activateTerminal(current, key))
  }, [])

  const move = useCallback((key: string, target: { paneId: string; edge: Edge | 'center' }) => {
    setLayout((current) => moveTerminal(current, key, target))
  }, [])

  /**
   * Ctrl+J. With terminals free to sit anywhere, "the panel" is not a thing
   * that can be toggled, so this means: give me a terminal. The first press
   * puts one under the editor, later presses hide and show whatever exists.
   */
  const toggleTerminals = useCallback(() => {
    // Read from the rendered layout rather than nesting one setState inside
    // another's updater: an updater has to be pure, and React is entitled to
    // run it twice.
    if (terminalKeys(layout).length > 0) {
      setHidden((was) => !was)
      return
    }
    const editor = editorPane(layout)
    if (editor === null) return
    const key = nextId('terminal')
    setHidden(false)
    setLayout(
      splitPane(layout, editor.id, 'bottom', {
        kind: 'pane',
        id: nextId('pane'),
        content: { type: 'terminals', terminals: [key], active: key }
      })
    )
  }, [layout])

  const reset = useCallback(() => {
    setLayout(defaultLayout())
    setHidden(false)
  }, [])

  return {
    layout,
    visible,
    setLayout,
    editorPaneId: editorPane(visible)?.id ?? null,
    terminalOrder,
    terminalSlots,
    hasTerminals: terminalOrder.length > 0,
    toggleTerminals,
    addTerminalTo,
    closeTerminal,
    activate,
    move,
    reset,
    restore
  }
}
