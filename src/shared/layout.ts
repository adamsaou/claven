/**
 * The workbench layout: a tree of splits, with panes at the leaves.
 *
 * Lives in `shared` rather than the renderer because it is pure data and pure
 * functions, and putting it here means the main process can unit test it
 * directly instead of the tests having to drive a browser to find out whether
 * collapsing a split works.
 *
 * **A pane holds a list of things and one of them is active.** That is the
 * whole model, and it is the same sentence for files as for terminals, so they
 * share every operation here: add, close, activate, drag somewhere else. The
 * editor used to be a special case that held no list at all, which is why
 * splitting one was a separate feature rather than the feature that already
 * existed.
 *
 * The one invariant everything else leans on: **at least one editor pane
 * exists, always.** It may be empty, showing the placeholder. It cannot be the
 * pane you close, because closing it would leave a window with nowhere to put
 * a file.
 */

export type Edge = 'left' | 'right' | 'top' | 'bottom'

export type PaneKind = 'editors' | 'terminals'

export type PaneContent = {
  type: PaneKind
  /**
   * File paths, or terminal keys.
   *
   * Terminal keys rather than pty ids: a view asks main for its shell after it
   * mounts, so the id does not exist at the moment a tab is created, and keying
   * a layout on something that arrives later means persisting a pane with no
   * identity.
   */
  items: string[]
  /** Null only for an empty editor pane, which is the one pane allowed to be empty. */
  active: string | null
}

export type Pane = { kind: 'pane'; id: string; content: PaneContent }

export type Split = {
  kind: 'split'
  id: string
  direction: 'row' | 'column'
  children: LayoutNode[]
  /** Fractions of the split's own extent. Always the same length as children, always sums to 1. */
  sizes: number[]
}

export type LayoutNode = Pane | Split

export function isPane(node: LayoutNode): node is Pane {
  return node.kind === 'pane'
}

export function isSplit(node: LayoutNode): node is Split {
  return node.kind === 'split'
}

/**
 * How much of the space a newly split-off pane takes.
 *
 * A terminal wants less than half, and so does a second file most of the time:
 * half is what a naive split gives you and it is wrong more often than not,
 * because the pane you were already in is the one you were working in.
 */
const NEW_PANE_FRACTION = 0.32

/** Nothing may be dragged smaller than this, in fractions of its split. */
export const MIN_FRACTION = 0.1

// ---- ids -------------------------------------------------------------------

/**
 * Deterministic rather than random, so a test can assert on a whole tree.
 * `seedIds` moves the counter past anything a restored layout already used,
 * which is the only way the two can coexist without colliding.
 */
let counter = 0

export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}${counter}`
}

export function seedIds(root: LayoutNode): void {
  let highest = counter
  const bump = (id: string): void => {
    const digits = /(\d+)$/.exec(id)
    if (digits !== null) highest = Math.max(highest, Number(digits[1]))
  }
  const visit = (node: LayoutNode): void => {
    bump(node.id)
    // Terminal keys come from the same counter, so a restored layout that
    // already holds terminal7 must not be handed a fresh pane called terminal7.
    // File paths are bumped harmlessly: they do not end in a bare number often,
    // and a counter that is too high is never a problem.
    if (isPane(node) && node.content.type === 'terminals') node.content.items.forEach(bump)
    if (isSplit(node)) node.children.forEach(visit)
  }
  visit(root)
  counter = highest
}

/** Only for tests, which need the counter to start from a known place. */
export function resetIds(): void {
  counter = 0
}

// ---- reading ---------------------------------------------------------------

export function emptyEditorPane(): Pane {
  return { kind: 'pane', id: nextId('pane'), content: { type: 'editors', items: [], active: null } }
}

export function defaultLayout(): LayoutNode {
  return emptyEditorPane()
}

export function panes(root: LayoutNode): Pane[] {
  if (isPane(root)) return [root]
  return root.children.flatMap(panes)
}

export function findPane(root: LayoutNode, id: string): Pane | null {
  return panes(root).find((pane) => pane.id === id) ?? null
}

export function panesOfKind(root: LayoutNode, kind: PaneKind): Pane[] {
  return panes(root).filter((pane) => pane.content.type === kind)
}

/** Everything of one kind in the tree, in layout order. */
export function itemsOfKind(root: LayoutNode, kind: PaneKind): string[] {
  return panesOfKind(root, kind).flatMap((pane) => pane.content.items)
}

export function paneOfItem(root: LayoutNode, kind: PaneKind, item: string): Pane | null {
  return panesOfKind(root, kind).find((pane) => pane.content.items.includes(item)) ?? null
}

// ---- rewriting -------------------------------------------------------------

/**
 * Replace one pane, by id, with whatever `replacer` returns. Returning null
 * deletes it, and the normalise pass afterwards tidies up whatever that leaves
 * behind: a split with one child, an empty split, two nested splits pointing
 * the same way.
 */
function rewrite(
  node: LayoutNode,
  id: string,
  replacer: (pane: Pane) => LayoutNode | null
): LayoutNode | null {
  if (isPane(node)) return node.id === id ? replacer(node) : node

  const children: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    const next = rewrite(child, id, replacer)
    if (next !== null) {
      children.push(next)
      sizes.push(node.sizes[index] ?? 0)
    }
  })
  return { ...node, children, sizes }
}

/**
 * Flatten and rescale.
 *
 * Without this every split leaves a nested one behind, and after five drags the
 * tree is a staircase of single-child splits whose dividers no longer line up
 * with anything. Merging a child into a parent of the same direction is the
 * part that keeps three panes in a row draggable against each other rather
 * than against whatever accident of nesting created them.
 */
export function normalise(node: LayoutNode): LayoutNode {
  if (isPane(node)) return node

  const children: LayoutNode[] = []
  const sizes: number[] = []

  node.children.forEach((rawChild, index) => {
    const child = normalise(rawChild)
    const size = node.sizes[index] ?? 0
    if (isSplit(child) && child.children.length === 0) return
    if (isSplit(child) && child.direction === node.direction) {
      // Absorb it. The child's fractions were of the child's extent, so they
      // scale by the slice the child itself held.
      child.children.forEach((grandchild, inner) => {
        children.push(grandchild)
        sizes.push(size * (child.sizes[inner] ?? 0))
      })
      return
    }
    children.push(child)
    sizes.push(size)
  })

  if (children.length === 1) return children[0]!
  if (children.length === 0) return { ...node, children: [], sizes: [] }

  const total = sizes.reduce((sum, size) => sum + size, 0)
  return {
    ...node,
    children,
    // A split whose sizes were lost (or never summed to 1) becomes even rather
    // than collapsing a pane to nothing.
    sizes: total > 0 ? sizes.map((size) => size / total) : sizes.map(() => 1 / sizes.length)
  }
}

/** Put `incoming` against one edge of the pane `id`. */
export function splitPane(root: LayoutNode, id: string, edge: Edge, incoming: Pane): LayoutNode {
  const direction = edge === 'left' || edge === 'right' ? 'row' : 'column'
  const before = edge === 'left' || edge === 'top'

  const next = rewrite(root, id, (pane) => ({
    kind: 'split',
    id: nextId('split'),
    direction,
    children: before ? [incoming, pane] : [pane, incoming],
    sizes: before
      ? [NEW_PANE_FRACTION, 1 - NEW_PANE_FRACTION]
      : [1 - NEW_PANE_FRACTION, NEW_PANE_FRACTION]
  }))
  return normalise(next ?? root)
}

export function updatePane(
  root: LayoutNode,
  id: string,
  update: (pane: Pane) => Pane
): LayoutNode {
  return normalise(rewrite(root, id, update) ?? root)
}

/** True when removing this pane would leave nowhere to open a file. */
export function isLastEditorPane(root: LayoutNode, id: string): boolean {
  const pane = findPane(root, id)
  if (pane === null || pane.content.type !== 'editors') return false
  return panesOfKind(root, 'editors').length === 1
}

/**
 * Drop a pane out of the tree.
 *
 * Refuses to remove the last editor pane. The caller cannot always know that
 * the pane it is closing is the last one that can hold a file, and losing it
 * would leave a window with nowhere to open one.
 */
export function removePane(root: LayoutNode, id: string): LayoutNode {
  if (findPane(root, id) === null || isLastEditorPane(root, id)) return root
  return normalise(rewrite(root, id, () => null) ?? root)
}

export function addItem(root: LayoutNode, paneId: string, item: string): LayoutNode {
  return updatePane(root, paneId, (pane) =>
    pane.content.items.includes(item)
      ? { ...pane, content: { ...pane.content, active: item } }
      : { ...pane, content: { ...pane.content, items: [...pane.content.items, item], active: item } }
  )
}

/**
 * Close one item, and the pane with it if it was the last one there.
 *
 * The next tab to activate is the one that took its place, falling back to the
 * one before it. Jumping to the first tab instead is the behaviour that makes
 * closing four files in a row feel like the strip is fighting you.
 */
export function removeItem(root: LayoutNode, kind: PaneKind, item: string): LayoutNode {
  const pane = paneOfItem(root, kind, item)
  if (pane === null) return root

  const remaining = pane.content.items.filter((candidate) => candidate !== item)
  // The last editor pane stays, empty, showing its placeholder. Every other
  // emptied pane goes away rather than leaving a header over nothing.
  if (remaining.length === 0 && !isLastEditorPane(root, pane.id)) {
    return removePane(root, pane.id)
  }

  const index = pane.content.items.indexOf(item)
  const active =
    pane.content.active === item
      ? (remaining[Math.min(index, remaining.length - 1)] ?? remaining[0] ?? null)
      : pane.content.active
  return updatePane(root, pane.id, (current) => ({
    ...current,
    content: { ...current.content, items: remaining, active }
  }))
}

export function activateItem(root: LayoutNode, kind: PaneKind, item: string): LayoutNode {
  const pane = paneOfItem(root, kind, item)
  if (pane === null) return root
  return updatePane(root, pane.id, (current) => ({
    ...current,
    content: { ...current.content, active: item }
  }))
}

/**
 * Move an item somewhere else: into another pane's tab strip (`center`) or
 * against one of its edges, which splits it.
 */
export function moveItem(
  root: LayoutNode,
  kind: PaneKind,
  item: string,
  target: { paneId: string; edge: Edge | 'center' }
): LayoutNode {
  const from = paneOfItem(root, kind, item)
  const to = findPane(root, target.paneId)
  if (from === null || to === null) return root

  // Dropping a pane's only item back onto that same pane is a no-op, and doing
  // it the long way would delete the pane and then try to split the hole.
  if (from.id === to.id && (target.edge === 'center' || from.content.items.length === 1)) {
    return root
  }
  // A tab strip only takes its own kind. Edges are open to anything, because
  // dropping a terminal beside an editor is the entire point.
  if (target.edge === 'center' && to.content.type !== kind) return root

  const detached = removeItem(root, kind, item)
  // Removing may have collapsed the source pane, but ids elsewhere are stable,
  // so the target is still findable by the id we were given.
  if (findPane(detached, target.paneId) === null) return root

  if (target.edge === 'center') return addItem(detached, target.paneId, item)

  return splitPane(detached, target.paneId, target.edge, {
    kind: 'pane',
    id: nextId('pane'),
    content: { type: kind, items: [item], active: item }
  })
}

/** Rename a file everywhere it appears. Used when something is renamed on disk. */
export function remapItems(
  root: LayoutNode,
  kind: PaneKind,
  move: (item: string) => string | null
): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode => {
    if (isSplit(node)) return { ...node, children: node.children.map(visit) }
    if (node.content.type !== kind) return node
    return {
      ...node,
      content: {
        ...node.content,
        items: node.content.items.map((item) => move(item) ?? item),
        active: node.content.active === null ? null : (move(node.content.active) ?? node.content.active)
      }
    }
  }
  return visit(root)
}

/**
 * The same tree with every pane of one kind taken out.
 *
 * Used to hide terminals without closing them. The layout itself is kept, so
 * the shells stay running and stay mounted: this is what gets drawn, not what
 * is stored. Toggling terminals off has to mean "off screen" rather than "the
 * dev server you started ten minutes ago is dead".
 */
export function stripPanes(root: LayoutNode, kind: PaneKind): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode | null => {
    if (isPane(node)) return node.content.type === kind ? null : node
    const children: LayoutNode[] = []
    const sizes: number[] = []
    node.children.forEach((child, index) => {
      const next = visit(child)
      if (next !== null) {
        children.push(next)
        sizes.push(node.sizes[index] ?? 0)
      }
    })
    return { ...node, children, sizes }
  }
  const stripped = visit(root)
  return stripped === null ? root : normalise(stripped)
}

/** Drag a divider. `index` is the child on the leading side of it. */
export function resizeSplit(
  root: LayoutNode,
  splitId: string,
  index: number,
  fraction: number
): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode => {
    if (isPane(node)) return node
    if (node.id !== splitId) return { ...node, children: node.children.map(visit) }

    const pair = (node.sizes[index] ?? 0) + (node.sizes[index + 1] ?? 0)
    // Only the two panes either side of the divider move. Spreading the change
    // across the whole row is what makes dragging one divider visibly shove
    // panes at the far end of the window.
    const clamped = Math.min(pair - MIN_FRACTION, Math.max(MIN_FRACTION, fraction))
    const sizes = [...node.sizes]
    sizes[index] = clamped
    sizes[index + 1] = pair - clamped
    return { ...node, sizes }
  }
  return visit(root)
}

// ---- persistence -----------------------------------------------------------

/**
 * Parse a layout that came from disk.
 *
 * Validated rather than trusted, and rejected whole rather than repaired. A
 * layout is cosmetic: falling back to the default costs the user one drag,
 * whereas booting into a half-understood tree costs them a window they cannot
 * use and cannot reset.
 */
export function parseLayout(raw: unknown): LayoutNode | null {
  const node = read(raw)
  if (node === null) return null
  if (panesOfKind(node, 'editors').length === 0) return null
  return normalise(node)
}

function read(raw: unknown): LayoutNode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string') return null

  if (value.kind === 'pane') {
    const content = value.content as Record<string, unknown> | undefined
    if (content === undefined) return null
    if (content.type !== 'editors' && content.type !== 'terminals') return null

    const items = Array.isArray(content.items)
      ? content.items.filter((item): item is string => typeof item === 'string')
      : []
    // A terminal pane with no terminals is not a thing the UI can draw. An
    // editor pane with no files is: it is the empty state.
    if (items.length === 0 && content.type !== 'editors') return null

    const active = typeof content.active === 'string' ? content.active : null
    return {
      kind: 'pane',
      id: value.id,
      content: {
        type: content.type,
        items,
        active: active !== null && items.includes(active) ? active : (items[0] ?? null)
      }
    }
  }

  if (value.kind === 'split') {
    if (value.direction !== 'row' && value.direction !== 'column') return null
    if (!Array.isArray(value.children)) return null
    const children = value.children.map(read)
    if (children.some((child) => child === null)) return null
    if (children.length === 0) return null
    const rawSizes = Array.isArray(value.sizes) ? value.sizes : []
    const sizes = children.map((_child, index) => {
      const size = rawSizes[index]
      return typeof size === 'number' && Number.isFinite(size) && size > 0
        ? size
        : 1 / children.length
    })
    return {
      kind: 'split',
      id: value.id,
      direction: value.direction,
      children: children as LayoutNode[],
      sizes
    }
  }

  return null
}
