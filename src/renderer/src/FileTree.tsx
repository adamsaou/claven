import { useCallback, useEffect, useState } from 'react'
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

type NodeProps = {
  entry: DirEntry
  depth: number
  activePath: string | null
  onOpenFile: (path: string) => void
}

function TreeNode({ entry, depth, activePath, onOpenFile }: NodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = useCallback(async () => {
    if (entry.kind === 'file') {
      onOpenFile(entry.path)
      return
    }
    const next = !expanded
    setExpanded(next)
    if (next && children === null) {
      const result = await window.claven.invoke('fs:list', { path: entry.path })
      if (result.ok) setChildren(result.value.entries)
      else setError(result.error.message)
    }
  }, [entry, expanded, children, onOpenFile])

  const isActive = activePath === entry.path
  const isArtifact = entry.kind === 'file' && ARTIFACT.test(entry.name)

  return (
    <>
      <button
        onClick={() => void toggle()}
        title={entry.path}
        style={{ paddingInlineStart: `${depth * 12 + 10}px` }}
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
            entry.kind === 'directory'
              ? expanded
                ? 'folderOpen'
                : 'folder'
              : iconForPath(entry.name)
          }
          size={14}
          className="shrink-0 opacity-80"
        />
        {/* dir="auto" so Arabic and Hebrew filenames render in their own
            direction rather than being forced left-to-right. */}
        <span dir="auto" className="truncate">
          {entry.name}
        </span>
        {entry.isSymlink && <span className="shrink-0 text-[10px] opacity-40">↗</span>}
      </button>

      {expanded && error !== null && (
        <div
          style={{ paddingInlineStart: `${depth * 12 + 25}px` }}
          className="text-error py-0.5 pe-2 text-xs"
        >
          {error}
        </div>
      )}

      {expanded &&
        children
          ?.filter((child) => !HIDDEN.has(child.name))
          .map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
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
}

export function FileTree({ root, activePath, onOpenFile, onOpenFolder }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[]>([])

  useEffect(() => {
    if (root === null) {
      setEntries([])
      return
    }
    void window.claven.invoke('fs:list', { path: root }).then((result) => {
      if (result.ok) setEntries(result.value.entries)
    })
  }, [root])

  const visible = entries.filter((entry) => !HIDDEN.has(entry.name))

  // Width comes from --sidebar-w (200px, per BRAND.md chrome metrics). No w-*
  // class here — two sources of truth for one width is how chrome metrics
  // quietly drift apart.
  return (
    <nav
      className="border-line bg-surface-1 flex h-full shrink-0 flex-col border-e"
      style={{ width: 'var(--sidebar-w)' }}
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

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {root !== null && visible.length === 0 && (
          <p className="text-ink-dim px-3 py-2 text-xs">empty folder</p>
        )}
        {visible.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </nav>
  )
}
