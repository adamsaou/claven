import type { Rect } from './Workbench'

/**
 * Every editor and every terminal, painted over the pane that owns it.
 *
 * This is the part of the split layout that is not obvious, so: **React
 * unmounts a component when it moves to a different parent.** Keys do not save
 * you, because a key only preserves an instance among its own siblings. So the
 * moment something can be dragged from one pane to another, or a pane can be
 * split, rendering it inside the tree means every layout change destroys it.
 * Not a rare edge case. Every single drag.
 *
 * For a terminal that means the shell dies. For an editor it means the undo
 * history and every cached scroll position go with it.
 *
 * So nothing stateful lives in the tree. `Workbench` renders empty boxes and
 * reports where they are, and everything here sits in one flat list that never
 * reorders, positioned absolutely. Moving something across the window changes
 * four numbers and touches no component identity at all.
 *
 * **The list must never reorder**, which is why the caller sorts by creation
 * rather than by position in the tree. React reorders keyed children by moving
 * DOM nodes, and moving an xterm detaches and reattaches it.
 */

export type Surface = {
  /** Stable for the life of the thing being drawn. A pane id, or a terminal key. */
  key: string
  /** Whose box to sit in. */
  paneId: string
  visible: boolean
  node: React.ReactNode
}

type Props = {
  rects: Record<string, Rect>
  surfaces: Surface[]
  /** Off during a drag, so the pane drop zones underneath can hear the pointer. */
  interactive: boolean
}

/**
 * Parked off-screen rather than hidden when a pane has not been measured yet,
 * or has gone away. `display: none` would make xterm measure zero and settle at
 * one column by one row, and it does not recover on its own.
 */
const UNMEASURED: React.CSSProperties = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  visibility: 'hidden'
}

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
      {props.surfaces.map((surface) => (
        <div
          key={surface.key}
          className="bg-obsidian absolute overflow-hidden"
          style={{
            ...boxFor(props.rects[surface.paneId], surface.visible),
            pointerEvents: props.interactive ? 'auto' : 'none'
          }}
        >
          {surface.node}
        </div>
      ))}
    </div>
  )
}
