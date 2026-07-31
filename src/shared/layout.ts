/**
 * The workbench layout: a tree of splits, with panes at the leaves.
 *
 * Lives in `shared` rather than the renderer because it is pure data and pure
 * functions, and putting it here means the main process can unit test it
 * directly instead of the tests having to drive a browser to find out whether
 * collapsing a split works.
 *
 * The invariant everything else leans on: **there is exactly one editor pane,
 * always.** It cannot be closed and it cannot be dragged away. Slice one holds
 * one editor, so a layout with none or two of them is a corrupt layout, not a
 * layout to be repaired into something the user did not ask for.
 */

export type Edge = 'left' | 'right' | 'top' | 'bottom'

export type PaneContent =
  | { type: 'editor' }
  /**
   * Terminal keys, not pty ids. A view asks main for its shell after it mounts,
   * so the id does not exist at the moment a tab is created, and keying a layout
   * on something that arrives later means persisting a pane with no identity.
   */
  | { type: 'terminals'; terminals: string[]; active: string }

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
 * A terminal wants less than half. Half is what a naive split gives you and it
 * is wrong every time: the code is the thing you are looking at.
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
    if (isPane(node) && node.content.type === 'terminals') node.content.terminals.forEach(bump)
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

export function defaultLayout(): LayoutNode {
  return { kind: 'pane', id: nextId('pane'), content: { type: 'editor' } }
}

export function panes(root: LayoutNode): Pane[] {
  if (isPane(root)) return [root]
  return root.children.flatMap(panes)
}

export function findPane(root: LayoutNode, id: string): Pane | null {
  return panes(root).find((pane) => pane.id === id) ?? null
}

export function editorPane(root: LayoutNode): Pane | null {
  return panes(root).find((pane) => pane.content.type === 'editor') ?? null
}

/** Every terminal key in the tree, in layout order. */
export function terminalKeys(root: LayoutNode): string[] {
  return panes(root).flatMap((pane) =>
    pane.content.type === 'terminals' ? pane.content.terminals : []
  )
}

export function paneOfTerminal(root: LayoutNode, key: string): Pane | null {
  return (
    panes(root).find(
      (pane) => pane.content.type === 'terminals' && pane.content.terminals.includes(key)
    ) ?? null
  )
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
 * part that keeps three terminals in a row draggable against each other rather
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
export function splitPane(
  root: LayoutNode,
  id: string,
  edge: Edge,
  incoming: Pane
): LayoutNode {
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

/**
 * Drop a pane out of the tree.
 *
 * Refuses to remove the editor pane. The caller cannot always know that the
 * pane it is closing is the last one holding the editor, and losing it would
 * leave a window with nowhere to put a file.
 */
export function removePane(root: LayoutNode, id: string): LayoutNode {
  const pane = findPane(root, id)
  if (pane === null || pane.content.type === 'editor') return root
  return normalise(rewrite(root, id, () => null) ?? root)
}

export function addTerminal(root: LayoutNode, paneId: string, key: string): LayoutNode {
  return updatePane(root, paneId, (pane) =>
    pane.content.type === 'terminals'
      ? {
          ...pane,
          content: { type: 'terminals', terminals: [...pane.content.terminals, key], active: key }
        }
      : pane
  )
}

/**
 * Close one terminal, and the pane with it if it was the last.
 *
 * The next tab to activate is the one that took its place, falling back to the
 * one before it. Jumping to the first tab instead is the behaviour that makes
 * closing four terminals in a row feel like the panel is fighting you.
 */
export function removeTerminal(root: LayoutNode, key: string): LayoutNode {
  const pane = paneOfTerminal(root, key)
  if (pane === null || pane.content.type !== 'terminals') return root

  const remaining = pane.content.terminals.filter((candidate) => candidate !== key)
  if (remaining.length === 0) return removePane(root, pane.id)

  const index = pane.content.terminals.indexOf(key)
  const active =
    pane.content.active === key
      ? (remaining[Math.min(index, remaining.length - 1)] ?? remaining[0]!)
      : pane.content.active
  return updatePane(root, pane.id, (current) => ({
    ...current,
    content: { type: 'terminals', terminals: remaining, active }
  }))
}

export function activateTerminal(root: LayoutNode, key: string): LayoutNode {
  const pane = paneOfTerminal(root, key)
  if (pane === null) return root
  return updatePane(root, pane.id, (current) =>
    current.content.type === 'terminals'
      ? { ...current, content: { ...current.content, active: key } }
      : current
  )
}

/**
 * Move a terminal somewhere else: into another pane's tab strip (`center`) or
 * against one of its edges, which splits it.
 */
export function moveTerminal(
  root: LayoutNode,
  key: string,
  target: { paneId: string; edge: Edge | 'center' }
): LayoutNode {
  const from = paneOfTerminal(root, key)
  const to = findPane(root, target.paneId)
  if (from === null || to === null || from.content.type !== 'terminals') return root

  // Dropping a pane's only terminal back onto that same pane is a no-op, and
  // doing it the long way would delete the pane and then try to split the hole.
  if (from.id === to.id && (target.edge === 'center' || from.content.terminals.length === 1)) {
    return root
  }
  // The editor pane holds the editor. Edges of it are fair game; its tab strip
  // is not.
  if (target.edge === 'center' && to.content.type !== 'terminals') return root

  const detached = removeTerminal(root, key)
  // Removing may have collapsed the source pane, but ids elsewhere are stable,
  // so the target is still findable by the id we were given.
  if (findPane(detached, target.paneId) === null) return root

  if (target.edge === 'center') {
    return updatePane(detached, target.paneId, (pane) =>
      pane.content.type === 'terminals'
        ? {
            ...pane,
            content: {
              type: 'terminals',
              terminals: [...pane.content.terminals, key],
              active: key
            }
          }
        : pane
    )
  }

  return splitPane(detached, target.paneId, target.edge, {
    kind: 'pane',
    id: nextId('pane'),
    content: { type: 'terminals', terminals: [key], active: key }
  })
}

/**
 * The same tree with every terminal pane taken out.
 *
 * Used to hide terminals without closing them. The layout itself is kept, so
 * the shells stay running and stay mounted: this is what gets drawn, not what
 * is stored. Toggling terminals off has to mean "off screen" rather than "the
 * dev server you started ten minutes ago is dead".
 */
export function stripTerminalPanes(root: LayoutNode): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode | null => {
    if (isPane(node)) return node.content.type === 'terminals' ? null : node
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
  if (panes(node).filter((pane) => pane.content.type === 'editor').length !== 1) return null
  return normalise(node)
}

function read(raw: unknown): LayoutNode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string') return null

  if (value.kind === 'pane') {
    const content = value.content as Record<string, unknown> | undefined
    if (content === undefined) return null
    if (content.type === 'editor') {
      return { kind: 'pane', id: value.id, content: { type: 'editor' } }
    }
    if (content.type === 'terminals') {
      const terminals = Array.isArray(content.terminals)
        ? content.terminals.filter((key): key is string => typeof key === 'string')
        : []
      // A terminal pane with no terminals is not a thing the UI can draw.
      if (terminals.length === 0) return null
      const active = typeof content.active === 'string' ? content.active : terminals[0]!
      return {
        kind: 'pane',
        id: value.id,
        content: {
          type: 'terminals',
          terminals,
          active: terminals.includes(active) ? active : terminals[0]!
        }
      }
    }
    return null
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
