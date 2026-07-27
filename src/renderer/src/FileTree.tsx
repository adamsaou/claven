import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, iconForPath } from './Icons'
import type { DirEntry } from '../../shared/files'

/**
 * Deliberately unvirtualised and single-root.
 *
 * A virtualised tree is the kind of thing that feels like real work and is not:
 * nobody has a directory with 10,000 entries in one folder, and if it turns out
 * they do, that is a real annoyance-log entry rather than a guess.
 */

/** Never worth a row. */
const HIDDEN = new Set(['.git', 'node_modules', 'out', 'dist', '.vite', '.venv', '__pycache__'])

/**
 * Compiled output. Shown but dimmed rather than hidden — in a competitive
 * programming folder every .cpp has a matching .exe, which doubles the tree,
 * but hiding a file the user can see on disk is worse than de-emphasising it.
 */
const ARTIFACT = /\.(exe|out|o|obj|class|pyc|pdb|ilk|dll|so|dylib|d)$/i

/** 8px, not 12. At 12 a five-deep java package eats 60px of a 200px sidebar. */
const INDENT = 8

const MIN_WIDTH = 140
const MAX_WIDTH = 560
const WIDTH_KEY = 'claven.sidebar.width'

async function list(path: string): Promise<DirEntry[]> {
  const result = await window.claven.invoke('fs:list', { path })
  if (!result.ok) throw new Error(result.error.message)
  return result.value.entries.filter((entry) => !HIDDEN.has(entry.name))
}

type NodeProps = {
  entry: DirEntry
  depth: number
  activePath: string | null
  onOpenFile: (path: string) => void
  onContextMenu: (entry: DirEntry, event: React.MouseEvent) => void
}

function TreeNode({
  entry,
  depth,
  activePath,
  onOpenFile,
  onContextMenu
}: NodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Deepest directory in the compact chain — what this node actually lists. */
  const [chainPath, setChainPath] = useState(entry.path)
  /**
   * Compact folder chain, the way VS Code does it. A directory whose only child
   * is a directory collapses into one row: `org/firstinspires/ftc/teamcode`
   * instead of four rows and 32px of indent that carry no information. FTC and
   * every other Java project is built entirely out of these.
   */
  const [chain, setChain] = useState<string[]>([entry.name])

  const load = useCallback(async () => {
    try {
      const names = [entry.name]
      let path = entry.path
      let current = await list(path)
      // Walk down while the directory has exactly one child and it is a folder.
      while (current.length === 1 && current[0]?.kind === 'directory') {
        const only = current[0]
        names.push(only.name)
        path = only.path
        current = await list(path)
      }
      setChain(names)
      setChainPath(path)
      setChildren(current)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [entry])

  const toggle = useCallback(async () => {
    if (entry.kind === 'file') {
      onOpenFile(entry.path)
      return
    }
    const next = !expanded
    setExpanded(next)
    if (next && children === null) await load()
  }, [entry, expanded, children, onOpenFile, load])

  // Refetch when this directory changes on disk, but only if it is open —
  // a collapsed node reloads when it is next expanded anyway.
  useEffect(
    () =>
      window.claven.subscribe('fs:invalidate', (payload) => {
        if (expanded && payload.path === chainPath) void load()
      }),
    [expanded, chainPath, load]
  )

  const isActive = activePath === entry.path
  const isArtifact = entry.kind === 'file' && ARTIFACT.test(entry.name)
  const label = chain.join('/')

  return (
    <>
      <button
        onClick={() => void toggle()}
        onContextMenu={(event) => onContextMenu(entry, event)}
        title={entry.path}
        style={{ paddingInlineStart: `${depth * INDENT + 8}px` }}
        className={`relative flex w-full items-center gap-1.5 py-[3px] pe-2 text-start text-[13px] transition-colors ${
          isActive
            ? 'bg-surface-2 text-ink'
            : isArtifact
              ? 'text-ink-dim hover:bg-surface-2/60'
              : 'text-ink-muted hover:bg-surface-2/60'
        }`}
      >
        {/* Ember marks the open file, matching the active tab's indicator so
            the two chrome surfaces agree about what is focused. */}
        {isActive && <span className="bg-ember absolute inset-y-0 start-0 w-0.5" />}
        <Icon
          name={
            entry.kind === 'directory' ? (expanded ? 'folderOpen' : 'folder') : iconForPath(entry.name)
          }
          size={14}
          className="shrink-0 opacity-80"
        />
        {/* dir="auto" goes on the text node, never on this row — on a flex
            container it would reverse the icon and the name for an Arabic
            filename and send the icon to the other side. */}
        <span dir="auto" className="truncate">
          {label}
        </span>
        {entry.isSymlink && <span className="shrink-0 text-[10px] opacity-40">↗</span>}
      </button>

      {expanded && error !== null && (
        <div
          style={{ paddingInlineStart: `${depth * INDENT + 23}px` }}
          className="text-error py-0.5 pe-2 text-xs"
        >
          {error}
        </div>
      )}

      {expanded &&
        children?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  )
}

type Props = {
  root: string | null
  activePath: string | null
  onOpenFile: (path: string) => void
  onOpenFolder: () => void
  onContextMenu: (entry: DirEntry | null, event: React.MouseEvent) => void
}

export function FileTree({
  root,
  activePath,
  onOpenFile,
  onOpenFolder,
  onContextMenu
}: Props): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : 200
  })
  const dragging = useRef(false)

  const reload = useCallback(() => {
    if (root === null) {
      setEntries([])
      return
    }
    void list(root)
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [root])

  useEffect(reload, [reload])

  useEffect(
    () =>
      window.claven.subscribe('fs:invalidate', (payload) => {
        if (payload.path === root) reload()
      }),
    [root, reload]
  )

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      if (!dragging.current) return
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX)))
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

  useEffect(() => localStorage.setItem(WIDTH_KEY, String(width)), [width])

  return (
    <nav
      className="border-line bg-surface-1 relative flex h-full shrink-0 flex-col border-e"
      style={{ width: `${width}px` }}
    >
      <div
        className="border-line flex shrink-0 items-center justify-between gap-2 border-b px-3"
        style={{ height: 'var(--titlebar-h)' }}
      >
        {/* "explorer", not the folder name — the title bar already names the
            workspace. Micro label per the brand type scale: 10/500/+0.14em caps. */}
        <span
          className="text-ink-dim truncate text-[10px] font-medium uppercase"
          style={{ letterSpacing: '0.14em' }}
        >
          explorer
        </span>
        <button
          onClick={onOpenFolder}
          className="border-line text-ink-muted hover:text-ink hover:border-ink-dim shrink-0 border px-2 py-0.5 text-[11px] transition-colors"
          style={{ borderRadius: 'var(--radius-xs)', transitionDuration: 'var(--dur-micro)' }}
        >
          open
        </button>
      </div>

      {/* Right-clicking the empty area below the tree targets the root, which
          is how you make a file at the top level. */}
      <div
        className="min-h-0 flex-1 overflow-auto py-1"
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) onContextMenu(null, event)
        }}
      >
        {root !== null && entries.length === 0 && (
          <p className="text-ink-dim px-3 py-2 text-xs">empty folder</p>
        )}
        {entries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>

      {/* Resize handle. 4px of grab area straddling the border so it is
          catchable without a visible gutter eating layout. */}
      <div
        onMouseDown={() => {
          dragging.current = true
          document.body.style.cursor = 'col-resize'
          // Without this, dragging selects text across the whole window.
          document.body.style.userSelect = 'none'
        }}
        onDoubleClick={() => setWidth(200)}
        title="drag to resize · double-click to reset"
        className="hover:bg-ember/40 absolute inset-y-0 -end-0.5 w-1 cursor-col-resize transition-colors"
        style={{ transitionDuration: 'var(--dur-micro)' }}
      />
    </nav>
  )
}
