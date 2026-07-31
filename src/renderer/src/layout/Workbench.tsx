import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  isPane,
  resizeSplit,
  type Edge,
  type LayoutNode,
  type Pane,
  type Split
} from '../../../shared/layout'
import { Icon } from '../Icons'

/**
 * Draws the layout tree: pane chrome, dividers, and the drop targets a drag
 * lands on.
 *
 * What it deliberately does not draw is the contents of a pane. Each pane's
 * body is an empty measured box, and the editor and the terminals are painted
 * over the top of it by `SurfaceLayer`. The reason is in that file, and it is
 * the whole reason this component looks emptier than it should.
 */

export type Rect = { left: number; top: number; width: number; height: number }

/** How close to an edge a drop has to be to mean "split here" rather than "add a tab". */
const EDGE_RATIO = 0.25

type Props = {
  layout: LayoutNode
  onLayout: (next: LayoutNode) => void
  /** The editor pane's tab strip. Stateless, so it can live in the tree and re-render freely. */
  editorTabs: React.ReactNode
  onRects: (rects: Record<string, Rect>) => void
  onAddTerminal: (paneId: string) => void
  onCloseTerminal: (key: string) => void
  onActivateTerminal: (key: string) => void
  onMoveTerminal: (key: string, target: { paneId: string; edge: Edge | 'center' }) => void
  /** Raised so the surface layer can drop out of the way of the drop zones. */
  onDragging: (active: boolean) => void
  /** Numbering is global and by layout order, so "terminal 3" means one thing across the window. */
  terminalOrder: string[]
}

export function Workbench(props: Props): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<string, HTMLElement>())
  const published = useRef('')

  const [dragging, setDraggingKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ paneId: string; edge: Edge | 'center' } | null>(
    null
  )

  const { onRects, onDragging } = props

  const setDragging = useCallback(
    (key: string | null) => {
      setDraggingKey(key)
      onDragging(key !== null)
      if (key === null) setDropTarget(null)
    },
    [onDragging]
  )

  const measure = useCallback(() => {
    const box = container.current?.getBoundingClientRect()
    if (box === undefined) return
    const rects: Record<string, Rect> = {}
    for (const [id, element] of slots.current) {
      const rect = element.getBoundingClientRect()
      rects[id] = {
        left: rect.left - box.left,
        top: rect.top - box.top,
        width: rect.width,
        height: rect.height
      }
    }
    // Only when something actually moved. A ResizeObserver that feeds state
    // which resizes the observed element is a loop, and this is the cheap
    // place to break it.
    const serialised = JSON.stringify(rects)
    if (serialised === published.current) return
    published.current = serialised
    onRects(rects)
  }, [onRects])

  /** After every render, because a layout change moves boxes without resizing the window. */
  useLayoutEffect(measure)

  useEffect(() => {
    const observer = new ResizeObserver(measure)
    if (container.current !== null) observer.observe(container.current)
    for (const element of slots.current.values()) observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
    // Re-observed when the tree changes, since that is when slots come and go.
  }, [measure, props.layout])

  const registerSlot = useCallback((id: string, element: HTMLElement | null): void => {
    if (element === null) slots.current.delete(id)
    else slots.current.set(id, element)
  }, [])

  // ---- dividers ----------------------------------------------------------

  const drag = useRef<{ split: Split; index: number; element: HTMLElement } | null>(null)

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const current = drag.current
      if (current === null) return
      const box = current.element.getBoundingClientRect()
      const along =
        current.split.direction === 'row'
          ? (event.clientX - box.left) / box.width
          : (event.clientY - box.top) / box.height
      const leading = current.split.sizes
        .slice(0, current.index)
        .reduce((sum, size) => sum + size, 0)
      props.onLayout(resizeSplit(props.layout, current.split.id, current.index, along - leading))
    }
    const onUp = (): void => {
      if (drag.current === null) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  })

  // ---- rendering ---------------------------------------------------------

  const renderPane = (pane: Pane): React.JSX.Element => (
    <div
      key={pane.id}
      // Marked in the DOM because the tests assert on what is on screen rather
      // than on the serialised tree: a layout that persists correctly and draws
      // in the wrong place is still broken.
      data-pane={pane.id}
      data-pane-kind={pane.content.type}
      className="flex min-h-0 min-w-0 flex-col"
      style={{ flex: '1 1 0' }}
    >
      {pane.content.type === 'editor' ? (
        props.editorTabs
      ) : (
        <TerminalStrip
          terminals={pane.content.terminals}
          active={pane.content.active}
          order={props.terminalOrder}
          onAdd={() => props.onAddTerminal(pane.id)}
          onClose={props.onCloseTerminal}
          onActivate={props.onActivateTerminal}
          onDragStart={setDragging}
          onDragEnd={() => setDragging(null)}
        />
      )}

      <div className="relative min-h-0 flex-1">
        {/* The measured box. Left empty on purpose. */}
        <div ref={(element) => registerSlot(pane.id, element)} className="h-full w-full" />

        {dragging !== null && (
          <DropZone
            paneId={pane.id}
            canTakeTabs={pane.content.type === 'terminals'}
            highlight={dropTarget?.paneId === pane.id ? dropTarget.edge : null}
            onOver={setDropTarget}
            onDrop={(target) => {
              props.onMoveTerminal(dragging, target)
              setDragging(null)
            }}
          />
        )}
      </div>
    </div>
  )

  const renderNode = (node: LayoutNode): React.JSX.Element => {
    if (isPane(node)) return renderPane(node)
    return <SplitBox key={node.id} split={node} renderChild={renderNode} onGrab={drag} />
  }

  return (
    <div ref={container} className="relative flex min-h-0 min-w-0 flex-1">
      {renderNode(props.layout)}
    </div>
  )
}

// ---- a split ---------------------------------------------------------------

function SplitBox({
  split,
  renderChild,
  onGrab
}: {
  split: Split
  renderChild: (node: LayoutNode) => React.JSX.Element
  onGrab: React.RefObject<{ split: Split; index: number; element: HTMLElement } | null>
}): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  const row = split.direction === 'row'

  return (
    <div
      ref={element}
      className={`flex min-h-0 min-w-0 ${row ? 'flex-row' : 'flex-col'}`}
      style={{ flex: '1 1 0' }}
    >
      {split.children.map((child, index) => (
        <Fragmentish key={child.id}>
          {/* flexGrow rather than a percentage width: the dividers cost real
              pixels, and percentages that ignore them drift the further right
              you go. */}
          <div
            className="flex min-h-0 min-w-0"
            style={{ flex: `${split.sizes[index] ?? 1} 1 0` }}
          >
            {renderChild(child)}
          </div>
          {index < split.children.length - 1 && (
            <div
              onMouseDown={() => {
                if (element.current === null) return
                onGrab.current = { split, index, element: element.current }
                document.body.style.cursor = row ? 'col-resize' : 'row-resize'
                document.body.style.userSelect = 'none'
              }}
              role="separator"
              aria-orientation={row ? 'vertical' : 'horizontal'}
              className={`bg-line hover:bg-ember/50 relative z-20 shrink-0 transition-colors ${
                row ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
              }`}
              style={{ transitionDuration: 'var(--dur-micro)' }}
            >
              {/* A one pixel line is right to look at and impossible to grab,
                  so the hit area is padded out either side of it. */}
              <span
                className={`absolute ${row ? '-inset-x-1 inset-y-0' : '-inset-y-1 inset-x-0'}`}
              />
            </div>
          )}
        </Fragmentish>
      ))}
    </div>
  )
}

/** A keyed fragment. `<>` cannot take a key and two elements per child need one. */
function Fragmentish({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>
}

// ---- terminal pane chrome --------------------------------------------------

function TerminalStrip({
  terminals,
  active,
  order,
  onAdd,
  onClose,
  onActivate,
  onDragStart,
  onDragEnd
}: {
  terminals: string[]
  active: string
  order: string[]
  onAdd: () => void
  onClose: (key: string) => void
  onActivate: (key: string) => void
  onDragStart: (key: string) => void
  onDragEnd: () => void
}): React.JSX.Element {
  return (
    <div
      className="border-line bg-surface-1 flex shrink-0 items-stretch border-b"
      style={{ height: 'var(--statusbar-h)' }}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {terminals.map((key) => {
          const isActive = key === active
          const number = order.indexOf(key) + 1
          return (
            <div
              key={key}
              draggable
              onDragStart={(event) => {
                // Required, or Chromium refuses to start the drag at all.
                event.dataTransfer.setData('text/plain', key)
                event.dataTransfer.effectAllowed = 'move'
                onDragStart(key)
              }}
              onDragEnd={onDragEnd}
              data-terminal-tab={key}
              className={`group border-line relative flex shrink-0 cursor-grab items-center gap-2 border-e ps-3 pe-2 transition-colors ${
                isActive ? 'bg-obsidian text-ink' : 'text-ink-dim hover:bg-surface-2'
              }`}
              style={{ transitionDuration: 'var(--dur-micro)' }}
            >
              {isActive && <span className="bg-ember absolute inset-x-0 top-0 h-0.5" />}
              <button
                onClick={() => onActivate(key)}
                className="flex items-center gap-1.5 text-[11px] font-medium"
              >
                <Icon name="terminal" size={12} className="shrink-0 opacity-80" />
                <span>{number}</span>
              </button>
              <button
                onClick={() => onClose(key)}
                aria-label={`close terminal ${number}`}
                className="text-ink-dim hover:text-ink flex h-4 w-4 shrink-0 items-center justify-center text-xs"
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          onClick={onAdd}
          aria-label="new terminal"
          title="new terminal in this pane"
          className="text-ink-dim hover:text-ink shrink-0 px-3 text-sm transition-colors"
          style={{ transitionDuration: 'var(--dur-micro)' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ---- drop targeting --------------------------------------------------------

function DropZone({
  paneId,
  canTakeTabs,
  highlight,
  onOver,
  onDrop
}: {
  paneId: string
  canTakeTabs: boolean
  highlight: Edge | 'center' | null
  onOver: (target: { paneId: string; edge: Edge | 'center' }) => void
  onDrop: (target: { paneId: string; edge: Edge | 'center' }) => void
}): React.JSX.Element {
  const edgeAt = (event: React.DragEvent<HTMLDivElement>): Edge | 'center' => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    // Whichever edge you are nearest, but only if you are actually near one.
    const nearest = Math.min(x, 1 - x, y, 1 - y)
    if (nearest > EDGE_RATIO && canTakeTabs) return 'center'
    if (nearest === x) return 'left'
    if (nearest === 1 - x) return 'right'
    if (nearest === y) return 'top'
    return 'bottom'
  }

  const band =
    highlight === null || highlight === 'center'
      ? undefined
      : {
          left: { left: 0, top: 0, width: '32%', height: '100%' },
          right: { right: 0, top: 0, width: '32%', height: '100%' },
          top: { left: 0, top: 0, width: '100%', height: '32%' },
          bottom: { left: 0, bottom: 0, width: '100%', height: '32%' }
        }[highlight]

  return (
    <div
      // Above the surface layer, so a pane already covered by a terminal is
      // still a place you can drop one.
      className="absolute inset-0 z-30"
      data-drop-pane={paneId}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onOver({ paneId, edge: edgeAt(event) })
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop({ paneId, edge: edgeAt(event) })
      }}
    >
      {highlight === 'center' && (
        <div className="border-ember bg-ember/10 absolute inset-0 border-2" />
      )}
      {band !== undefined && (
        <div className="border-ember bg-ember/15 absolute border-2" style={band} />
      )}
    </div>
  )
}
