import { TerminalView } from '../terminal/TerminalView'
import type { Rect } from './Workbench'

/**
 * The editor and every terminal, painted over the panes that own them.
 *
 * This is the part of the split layout that is not obvious, so: **React
 * unmounts a component when it moves to a different parent.** Keys do not save
 * you, because a key only preserves an instance among its own siblings. So the
 * moment a terminal can be dragged from one pane to another, or a pane can be
 * split, rendering terminals inside the tree means every layout change kills a
 * shell. Not a rare edge case. Every single drag.
 *
 * So nothing stateful lives in the tree. `Workbench` renders empty boxes and
 * reports where they are, and everything here sits in one flat list that never
 * reorders, positioned absolutely. Moving a terminal across the window changes
 * four numbers and touches no component identity at all.
 *
 * The same argument applies to the editor, which would otherwise lose its undo
 * history and every cached scroll position on a split.
 */

type TerminalSlot = { key: string; paneId: string; visible: boolean }

type Props = {
  rects: Record<string, Rect>
  editorPaneId: string | null
  editor: React.ReactNode
  terminals: TerminalSlot[]
  onTerminalExit: (key: string) => void
  /** Off during a drag, so pane drop zones underneath can hear the pointer. */
  interactive: boolean
}

/**
 * Parked off-screen rather than hidden when a pane has not been measured yet.
 * `display: none` would make xterm measure zero and settle at one column by
 * one row, and it does not recover on its own.
 */
const UNMEASURED: React.CSSProperties = { left: 0, top: 0, width: 0, height: 0, visibility: 'hidden' }

function boxFor(rect: Rect | undefined, visible: boolean): React.CSSProperties {
  if (rect === undefined) return UNMEASURED
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    visibility: visible ? 'visible' : 'hidden'
  }
}

export function SurfaceLayer(props: Props): React.JSX.Element {
  return (
    // The layer itself never takes the pointer; only the surfaces in it do.
    <div className="absolute inset-0 z-10" style={{ pointerEvents: 'none' }}>
      <div
        className="absolute overflow-hidden"
        style={{
          ...boxFor(
            props.editorPaneId === null ? undefined : props.rects[props.editorPaneId],
            true
          ),
          pointerEvents: props.interactive ? 'auto' : 'none'
        }}
      >
        {props.editor}
      </div>

      {props.terminals.map((slot) => (
        <div
          key={slot.key}
          className="bg-obsidian absolute overflow-hidden"
          style={{
            ...boxFor(props.rects[slot.paneId], slot.visible),
            pointerEvents: props.interactive ? 'auto' : 'none'
          }}
        >
          <TerminalView visible={slot.visible} onExit={() => props.onTerminalExit(slot.key)} />
        </div>
      ))}
    </div>
  )
}
