import { useEffect, useState } from 'react'
import { Picker, Highlighted } from './Picker'
import { Icon, iconForPath } from './Icons'

type Props = {
  open: boolean
  root: string | null
  onPick: (relativePath: string) => void
  onClose: () => void
}

/**
 * Open a file by typing part of its name — ctrl+p.
 *
 * The file list is walked once in the main process and cached, rather than
 * re-walked on every keystroke: a tree of a few thousand files is instant to
 * filter and slow to enumerate, so the cost belongs at open time. It is
 * invalidated whenever the tree changes on disk.
 */
export function QuickOpen({ open, root, onPick, onClose }: Props): React.JSX.Element | null {
  const [files, setFiles] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [stale, setStale] = useState(true)

  useEffect(() => setStale(true), [root])
  useEffect(() => window.claven.subscribe('fs:invalidate', () => setStale(true)), [])

  useEffect(() => {
    if (!open || !stale || root === null) return
    void window.claven.invoke('fs:walk', {}).then((result) => {
      if (!result.ok) return
      setFiles(result.value.files)
      setTruncated(result.value.truncated)
      setStale(false)
    })
  }, [open, stale, root])

  return (
    <Picker
      open={open}
      placeholder="type a filename"
      items={files}
      keyOf={(path) => path}
      searchOf={(path) => path}
      emptyLabel={root === null ? 'no folder open' : 'no matching file'}
      onPick={onPick}
      onClose={onClose}
      footer={
        truncated
          ? `showing the first ${files.length.toLocaleString()} files — the rest were skipped`
          : undefined
      }
      renderRow={(path, match, selected) => {
        const slash = path.lastIndexOf('/')
        const directory = slash === -1 ? '' : path.slice(0, slash + 1)
        const name = slash === -1 ? path : path.slice(slash + 1)
        return (
          <>
            {selected && <span className="bg-ember absolute inset-y-0 start-0 w-0.5" />}
            <Icon name={iconForPath(name)} size={14} className="shrink-0 opacity-80" />
            {/* The full path is what was matched, so highlight it as one
                string and let the directory recede visually. */}
            <span dir="auto" className="flex-1 truncate">
              <span className="text-ink-dim">
                <Highlighted text={directory} match={{ ...match, positions: match.positions.filter((p) => p < directory.length) }} />
              </span>
              <Highlighted
                text={name}
                match={{
                  ...match,
                  positions: match.positions
                    .filter((p) => p >= directory.length)
                    .map((p) => p - directory.length)
                }}
              />
            </span>
          </>
        )
      }}
    />
  )
}
