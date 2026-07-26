import { useCallback, useEffect, useState } from 'react'
import type { DirEntry } from '../../shared/files'

/**
 * Deliberately unvirtualised and single-root.
 *
 * A virtualised tree is the kind of thing that feels like real work and is not:
 * nobody has a directory with 10,000 entries in one folder, and if it turns out
 * they do, that is a real annoyance-log entry rather than a guess.
 */

const HIDDEN = new Set(['.git', 'node_modules', 'out', 'dist', '.vite'])

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

  return (
    <>
      <button
        onClick={() => void toggle()}
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        className={`flex w-full items-center gap-1.5 py-0.5 pe-2 text-start text-[13px] hover:bg-white/5 ${
          isActive ? 'bg-white/10 text-ink' : 'text-ink-dim'
        }`}
      >
        <span className="w-3 shrink-0 opacity-60">
          {entry.kind === 'directory' ? (expanded ? '▾' : '▸') : ''}
        </span>
        {/* dir="auto" so Arabic and Hebrew filenames render in their own
            direction rather than being forced left-to-right. */}
        <span dir="auto" className="truncate">
          {entry.name}
        </span>
        {entry.isSymlink && <span className="shrink-0 opacity-40">↗</span>}
      </button>

      {expanded && error && (
        <div style={{ paddingInlineStart: `${depth * 12 + 24}px` }} className="text-bad py-0.5 text-xs">
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

  return (
    <nav className="border-edge bg-surface-raised flex h-full w-64 shrink-0 flex-col border-e">
      <div className="border-edge flex items-center justify-between border-b px-3 py-2">
        <span className="text-ink-dim truncate text-xs uppercase tracking-wide">
          {root === null ? 'no folder' : root.split(/[\\/]/).pop()}
        </span>
        <button
          onClick={onOpenFolder}
          className="border-edge hover:bg-edge shrink-0 rounded border px-2 py-0.5 text-xs"
        >
          open
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {entries
          .filter((entry) => !HIDDEN.has(entry.name))
          .map((entry) => (
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
