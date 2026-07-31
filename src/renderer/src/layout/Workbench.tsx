import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  isPane,
  resizeSplit,
  type Edge,
  type LayoutNode,
  type Pane,
  type PaneKind,
  type Split
} from '../../../shared/layout'

/**
 * Draws the layout tree: pane chrome, dividers, and the drop targets a drag
 * lands on.
 *
 * What it deliberately does not draw is the contents of a pane. Each pane's
 * body is an empty measured box, and the editors and the terminals are painted
 * over the top of it by `SurfaceLayer`. The reason is in that file, and it is
 * the whole reason this component looks emptier than it should.
 */

export type Rect = { left: number; top: number; width: number; height: number }

/** How close to an edge a drop has to be to mean "split here" rather than "add a tab". */
const EDGE_RATIO = 0.25

/** What a pane's tab strip needs in order to draw one tab. */
export type TabView = {
  key: string
  label: string
  /** Rendered before the label. Omit for none. */
  icon?: React.ReactNode
  /** Shows the dot-becomes-cross treatment on the close control. */
  dirty?: boolean
  title?: string
  /**
   * The close button's accessible name. Given rather than derived, because a
   * terminal's label is a bare number and "close 1" describes nothing.
   */
  closeLabel: string
}

export type Drag = { kind: PaneKind; item: string }

type Props = {
  layout: LayoutNode
  onLayout: (next: LayoutNode) => void
  focusedPaneId: string
  onFocusPane: (paneId: string) => void
  /** Tabs for one pane, in the order they should be drawn. */
  tabsFor: (pane: Pane) => TabView[]
  /** The empty state for a pane with nothing in it. Editors only. */
  emptyEditorState: React.ReactNode
  onRects: (rects: Record<string, Rect>) => void
  onSelectTab: (kind: PaneKind, item: string) => void
  onCloseTab: (kind: PaneKind, item: string) => void
  onAddTerminal: (paneId: string) => void
  onMoveItem: (kind: PaneKind, item: string, target: { paneId: string; edge: Edge | 'center' }) => void
  onDragging: (active: boolean) => void
}

export function Workbench(props: Props): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<string, HTMLElement>())
  const published = useRef('')

  const [dragging, setDraggingItem] = useState<Drag | null>(null)
  const [dropTarget, setDropTarget] = useState<{ paneId: string; edge: Edge | 'center' } | null>(
    null
  )

  const { onRects, onDragging } = props

  const setDragging = useCallback(
    (drag: Drag | null) => {
      setDraggingItem(drag)
      onDragging(drag !== null)
      if (drag === null) setDropTarget(null)
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

  const renderPane = (pane: Pane): React.JSX.Element => {
    const kind = pane.content.type
    const isEditors = kind === 'editors'
    const empty = pane.content.items.length === 0

    return (
      <div
        key={pane.id}
        // Marked in the DOM because the tests assert on what is on screen
        // rather than on the serialised tree: a layout that persists correctly
        // and draws in the wrong place is still broken.
        data-pane={pane.id}
        data-pane-kind={kind}
        data-focused={isEditors && pane.id === props.focusedPaneId ? '' : undefined}
        onMouseDownCapture={() => {
          if (isEditors) props.onFocusPane(pane.id)
        }}
        className="flex min-h-0 min-w-0 flex-col"
        style={{ flex: '1 1 0' }}
      >
        <TabStrip
          pane={pane}
          tabs={props.tabsFor(pane)}
          focused={isEditors && pane.id === props.focusedPaneId}
          onSelect={(item) => props.onSelectTab(kind, item)}
          onClose={(item) => props.onCloseTab(kind, item)}
          onAdd={isEditors ? undefined : () => props.onAddTerminal(pane.id)}
          onDragStart={(item) => setDragging({ kind, item })}
          onDragEnd={() => setDragging(null)}
        />

        <div className="relative min-h-0 flex-1">
          {/* The measured box. Left empty on purpose. */}
          <div ref={(element) => registerSlot(pane.id, element)} className="h-full w-full" />

          {/* The one thing drawn in the tree rather than over it, because there
              is no surface to draw: an editor pane holding no file. */}
          {isEditors && empty && (
            <div className="pointer-events-none absolute inset-0">{props.emptyEditorState}</div>
          )}

          {dragging !== null && (
            <DropZone
              paneId={pane.id}
              // A tab strip only takes its own kind. Edges take anything.
              canTakeTabs={kind === dragging.kind}
              highlight={dropTarget?.paneId === pane.id ? dropTarget.edge : null}
              onOver={setDropTarget}
              onDrop={(target) => {
                props.onMoveItem(dragging.kind, dragging.item, target)
                setDragging(null)
              }}
            />
          )}
        </div>
      </div>
    )
  }

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
          <div className="flex min-h-0 min-w-0" style={{ flex: `${split.sizes[index] ?? 1} 1 0` }}>
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
              <span className={`absolute ${row ? '-inset-x-1 inset-y-0' : '-inset-y-1 inset-x-0'}`} />
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

// ---- pane chrome -----------------------------------------------------------

/**
 * One strip for both kinds of pane.
 *
 * Files and terminals were two separate strips that had drifted apart in three
 * ways nobody chose: different tab heights, different active indicators, and
 * only one of them draggable. They are the same control.
 */
function TabStrip({
  pane,
  tabs,
  focused,
  onSelect,
  onClose,
  onAdd,
  onDragStart,
  onDragEnd
}: {
  pane: Pane
  tabs: TabView[]
  focused: boolean
  onSelect: (item: string) => void
  onClose: (item: string) => void
  onAdd?: (() => void) | undefined
  onDragStart: (item: string) => void
  onDragEnd: () => void
}): React.JSX.Element {
  const isEditors = pane.content.type === 'editors'
  return (
    <div
      className="border-line bg-surface-1 flex shrink-0 items-stretch overflow-x-auto border-b"
      style={{ height: isEditors ? 'var(--titlebar-h)' : 'var(--statusbar-h)' }}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.key === pane.content.active
          return (
            <div
              key={tab.key}
              draggable
              onDragStart={(event) => {
                // Required, or Chromium refuses to start the drag at all.
                event.dataTransfer.setData('text/plain', tab.key)
                event.dataTransfer.effectAllowed = 'move'
                onDragStart(tab.key)
              }}
              onDragEnd={onDragEnd}
              data-tab={tab.key}
              className={`group border-line relative flex shrink-0 cursor-grab items-center gap-2 border-e ps-3 pe-2 transition-colors ${
                isActive ? 'bg-obsidian text-ink' : 'text-ink-muted hover:bg-surface-2'
              }`}
              style={{ transitionDuration: 'var(--dur-micro)' }}
            >
              {/* Ember as the active indicator, per BRAND.md. Dimmed in a pane
                  that is not focused, so with four panes open it is still
                  obvious which one your next keystroke goes to. */}
              {isActive && (
                <span
                  className={`bg-ember absolute inset-x-0 top-0 h-0.5 ${
                    isEditors && !focused ? 'opacity-30' : ''
                  }`}
                />
              )}
              <button
                onClick={() => onSelect(tab.key)}
                title={tab.title}
                className={`flex min-w-0 items-center gap-1.5 ${isEditors ? '' : 'text-[11px] font-medium'}`}
              >
                {tab.icon}
                {/* dir="auto" sits on the text node, never on the flex row: on
                    a container it would reverse the icon and the name for an
                    Arabic filename. */}
                <span dir="auto" className="max-w-48 truncate text-[13px]">
                  {tab.label}
                </span>
              </button>
              <button
                onClick={() => onClose(tab.key)}
                aria-label={tab.closeLabel}
                className="text-ink-dim hover:text-ink flex h-4 w-4 shrink-0 items-center justify-center text-xs"
              >
                {/* The dot marks unsaved and becomes a close affordance on
                    hover, so one slot carries both without a second control. */}
                <span className={tab.dirty === true ? 'group-hover:hidden' : 'hidden'}>●</span>
                <span className={tab.dirty === true ? 'hidden group-hover:inline' : 'inline'}>×</span>
              </button>
            </div>
          )
        })}
        {onAdd !== undefined && (
          <button
            onClick={onAdd}
            aria-label="new terminal"
            title="new terminal in this pane"
            className="text-ink-dim hover:text-ink shrink-0 px-3 text-sm transition-colors"
            style={{ transitionDuration: 'var(--dur-micro)' }}
          >
            +
          </button>
        )}
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
      // Above the surface layer, so a pane already covered by an editor or a
      // terminal is still a place you can drop one.
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
