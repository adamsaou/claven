import { useCallback, useMemo, useState } from 'react'
import {
  activateItem,
  addItem,
  defaultLayout,
  emptyEditorPane,
  findPane,
  isLastEditorPane,
  itemsOfKind,
  moveItem,
  nextId,
  paneOfItem,
  panes,
  panesOfKind,
  parseLayout,
  remapItems,
  removeItem,
  removePane,
  seedIds,
  splitPane,
  stripPanes,
  type Edge,
  type LayoutNode,
  type Pane,
  type PaneKind
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

export type Slot = { key: string; paneId: string; visible: boolean }

export type LayoutApi = {
  layout: LayoutNode
  /** What to draw. Differs from `layout` only while terminals are hidden. */
  visible: LayoutNode
  setLayout: (next: LayoutNode) => void

  editorPanes: Pane[]
  /** Where a newly opened file lands, and whose file the status bar describes. */
  focusedPaneId: string
  focusPane: (paneId: string) => void
  /** The focused pane's current file. */
  activePath: string | null
  openPaths: string[]
  editorSlots: Slot[]
  openInFocused: (path: string) => void
  activateFile: (path: string) => void
  closeFile: (path: string) => void
  remapFiles: (move: (path: string) => string | null) => void
  reconcileFiles: (paths: string[], active: string | null) => void
  cycleInFocused: (delta: number) => void
  splitFocusedEditor: () => void

  terminalOrder: string[]
  terminalSlots: Slot[]
  toggleTerminals: () => void
  addTerminalTo: (paneId: string) => void
  closeTerminal: (key: string) => void
  activateTerminal: (key: string) => void

  moveItemTo: (
    kind: PaneKind,
    item: string,
    target: { paneId: string; edge: Edge | 'center' }
  ) => void
  reset: () => void
  /** Called once, with whatever the session held. Ignores anything unusable. */
  restore: (stored: LayoutNode | null) => void
}

/**
 * Ordered by creation, never by position in the tree.
 *
 * The surface layer's whole premise is a list that never reorders. Ordering it
 * by the layout breaks that the first time you drag something: React reorders
 * the keyed children, which is a DOM move, and moving an xterm detaches and
 * reattaches it. Sorting by key makes the order depend only on which items
 * exist, so a drag changes four numbers on a style attribute and nothing else.
 */
function byCreation(keys: string[]): string[] {
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

function slotsFor(root: LayoutNode, kind: PaneKind, hidden: boolean, order: string[]): Slot[] {
  const slots = panesOfKind(root, kind).flatMap((pane) =>
    pane.content.items.map((key) => ({
      key,
      paneId: pane.id,
      // A hidden item stays mounted and loses its rect, which parks it off
      // screen with whatever is running in it still running.
      visible: !hidden && key === pane.content.active
    }))
  )
  return slots.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}

export function useLayout(): LayoutApi {
  const [layout, setLayout] = useState<LayoutNode>(defaultLayout)
  const [hidden, setHidden] = useState(false)
  const [focusedRequest, setFocusedRequest] = useState<string | null>(null)

  const restore = useCallback((stored: LayoutNode | null) => {
    const parsed = parseLayout(stored)
    if (parsed === null) return
    // The ids came back with it, so the counter has to clear them before
    // anything new is created against the same tree.
    seedIds(parsed)
    setLayout(parsed)
  }, [])

  const editorPanes = useMemo(() => panesOfKind(layout, 'editors'), [layout])

  /**
   * Focus falls back rather than being stored blindly: the pane you last
   * clicked may have been closed since, and a focused id pointing at nothing
   * means a newly opened file has nowhere to go.
   */
  const focusedPaneId =
    focusedRequest !== null && editorPanes.some((pane) => pane.id === focusedRequest)
      ? focusedRequest
      : (editorPanes[0]?.id ?? '')

  const focusedPane = editorPanes.find((pane) => pane.id === focusedPaneId) ?? null
  const activePath = focusedPane?.content.active ?? null

  const visible = useMemo(() => (hidden ? stripPanes(layout, 'terminals') : layout), [layout, hidden])
  const openPaths = useMemo(() => itemsOfKind(layout, 'editors'), [layout])
  const terminalOrder = useMemo(() => byCreation(itemsOfKind(layout, 'terminals')), [layout])

  // Editors are ordered by their pane rather than by their own key, because a
  // file moves between panes while a pane stays put. Sorting the paths would
  // reorder the list every time you opened a file whose name sorts early.
  const editorPaneOrder = useMemo(
    () => byCreation(panesOfKind(layout, 'editors').map((pane) => pane.id)),
    [layout]
  )
  const editorSlots = useMemo(
    () =>
      editorPaneOrder
        .filter((paneId) => findPane(layout, paneId) !== null)
        .map((paneId) => ({ key: paneId, paneId, visible: true })),
    [layout, editorPaneOrder]
  )

  const terminalSlots = useMemo(
    () => slotsFor(layout, 'terminals', hidden, terminalOrder),
    [layout, hidden, terminalOrder]
  )

  // ---- editors -----------------------------------------------------------

  const focusPane = useCallback((paneId: string) => setFocusedRequest(paneId), [])

  const openInFocused = useCallback(
    (path: string) => {
      // Already open somewhere: go to it rather than opening a second view of
      // it. Two views of one file need one shared document underneath, and two
      // that drift apart is a way to lose work rather than a feature.
      const existing = paneOfItem(layout, 'editors', path)
      if (existing !== null) {
        setFocusedRequest(existing.id)
        setLayout(activateItem(layout, 'editors', path))
        return
      }
      if (focusedPaneId === '') return
      setLayout(addItem(layout, focusedPaneId, path))
    },
    [layout, focusedPaneId]
  )

  const activateFile = useCallback(
    (path: string) => {
      const pane = paneOfItem(layout, 'editors', path)
      if (pane === null) return
      setFocusedRequest(pane.id)
      setLayout(activateItem(layout, 'editors', path))
    },
    [layout]
  )

  const closeFile = useCallback((path: string) => {
    setLayout((current) => removeItem(current, 'editors', path))
  }, [])

  const remapFiles = useCallback((move: (path: string) => string | null) => {
    setLayout((current) => remapItems(current, 'editors', move))
  }, [])

  /**
   * Make the panes agree with the set of documents that actually loaded.
   *
   * Two things go wrong at startup without it. A restored layout can name a
   * file that has since been deleted, which would draw a tab for a document
   * that does not exist. And a session saved before layouts were stored has
   * open files and no idea where to put them, which would restore them into
   * nothing at all. Both are the same fix from opposite directions: drop what
   * is not there, place what has nowhere to be.
   *
   * Takes the file to activate as well, rather than leaving the caller to call
   * `activateFile` afterwards. Two updates in a row both read the layout as it
   * was before either ran, so the second one looked for a file the first had
   * only just placed, found nothing, and left whichever file happened to be
   * added last showing instead.
   */
  const reconcileFiles = useCallback((paths: string[], active: string | null) => {
    setLayout((current) => {
      const wanted = new Set(paths)
      let next = itemsOfKind(current, 'editors')
        .filter((path) => !wanted.has(path))
        .reduce((tree, path) => removeItem(tree, 'editors', path), current)

      const placed = new Set(itemsOfKind(next, 'editors'))
      const home = panesOfKind(next, 'editors')[0]
      if (home === undefined) return next
      for (const path of paths) {
        if (!placed.has(path)) next = addItem(next, home.id, path)
      }
      return active !== null && paths.includes(active)
        ? activateItem(next, 'editors', active)
        : next
    })
  }, [])

  const cycleInFocused = useCallback(
    (delta: number) => {
      if (focusedPane === null) return
      const files = focusedPane.content.items
      if (files.length === 0) return
      const index = files.indexOf(focusedPane.content.active ?? '')
      const next = files[(index + delta + files.length) % files.length]
      if (next !== undefined) setLayout(activateItem(layout, 'editors', next))
    },
    [layout, focusedPane]
  )

  /**
   * Put the current file in a new pane beside this one.
   *
   * The keyboard route to what dragging a tab does, and the only route when the
   * pane holds a single file: dragging that tab back onto its own pane is
   * deliberately a no-op, so there would otherwise be no way to split at all.
   */
  const splitFocusedEditor = useCallback(() => {
    if (focusedPane === null) return
    const path = focusedPane.content.active
    const remaining = focusedPane.content.items.filter((item) => item !== path)
    const pane = emptyEditorPane()
    if (path !== null && remaining.length > 0) {
      // Move it across, the same as dragging the tab would.
      setLayout(
        splitPane(removeItem(layout, 'editors', path), focusedPaneId, 'right', {
          ...pane,
          content: { type: 'editors', items: [path], active: path }
        })
      )
    } else {
      // Nothing to move, or moving it would empty this pane. Open an empty one.
      setLayout(splitPane(layout, focusedPaneId, 'right', pane))
    }
    setFocusedRequest(pane.id)
  }, [layout, focusedPane, focusedPaneId])

  // ---- terminals ---------------------------------------------------------

  const addTerminalTo = useCallback((paneId: string) => {
    setLayout((current) => addItem(current, paneId, nextId('terminal')))
    setHidden(false)
  }, [])

  const closeTerminal = useCallback((key: string) => {
    setLayout((current) => removeItem(current, 'terminals', key))
  }, [])

  const activateTerminal = useCallback((key: string) => {
    setLayout((current) => activateItem(current, 'terminals', key))
  }, [])

  /**
   * Ctrl+J. With terminals free to sit anywhere, "the panel" is not a thing
   * that can be toggled, so this means: give me a terminal. The first press
   * puts one under the focused editor, later presses hide and show what exists.
   */
  const toggleTerminals = useCallback(() => {
    // Read from the rendered layout rather than nesting one setState inside
    // another's updater: an updater has to be pure, and React is entitled to
    // run it twice.
    if (itemsOfKind(layout, 'terminals').length > 0) {
      setHidden((was) => !was)
      return
    }
    if (focusedPaneId === '') return
    const key = nextId('terminal')
    setHidden(false)
    setLayout(
      splitPane(layout, focusedPaneId, 'bottom', {
        kind: 'pane',
        id: nextId('pane'),
        content: { type: 'terminals', items: [key], active: key }
      })
    )
  }, [layout, focusedPaneId])

  // ---- both --------------------------------------------------------------

  const moveItemTo = useCallback(
    (kind: PaneKind, item: string, target: { paneId: string; edge: Edge | 'center' }) => {
      const next = moveItem(layout, kind, item, target)
      // Dragging a file somewhere is a statement about where you want to be
      // working, so focus goes with it.
      if (kind === 'editors') {
        const landed = paneOfItem(next, 'editors', item)
        if (landed !== null) setFocusedRequest(landed.id)
      }
      setLayout(next)
    },
    [layout]
  )

  const reset = useCallback(() => {
    setLayout(defaultLayout())
    setHidden(false)
    setFocusedRequest(null)
  }, [])

  return {
    layout,
    visible,
    setLayout,
    editorPanes,
    focusedPaneId,
    focusPane,
    activePath,
    openPaths,
    editorSlots,
    openInFocused,
    activateFile,
    closeFile,
    remapFiles,
    reconcileFiles,
    cycleInFocused,
    splitFocusedEditor,
    terminalOrder,
    terminalSlots,
    toggleTerminals,
    addTerminalTo,
    closeTerminal,
    activateTerminal,
    moveItemTo,
    reset,
    restore
  }
}
