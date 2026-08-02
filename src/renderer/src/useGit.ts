import { useEffect, useMemo, useRef, useState } from 'react'
import { lineChanges, type LineChange } from '../../shared/linediff'
import type { GitBaseline } from '../../shared/ipc'

/**
 * The git gutter's data, and the branch.
 *
 * The diff is computed here, in the renderer, against the buffer rather than
 * against the file. A gutter that only moves when you save is describing your
 * last save, which is the same bug search had until it was fixed. Main supplies
 * the committed text and nothing else.
 */

const DEBOUNCE_MS = 150

export type GitState = {
  branch: string | null
  changedLines: { docId: string; lines: readonly LineChange[] } | undefined
}

export function useGit(
  activePath: string | null,
  content: string | null,
  /** Bumped whenever something might have changed the repo: a save, or a file event. */
  revision: number
): GitState {
  const [branch, setBranch] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<{ path: string; value: GitBaseline } | null>(null)
  const [debounced, setDebounced] = useState<string | null>(content)
  const latestPath = useRef<string | null>(null)

  useEffect(() => {
    void window.claven.invoke('git:info', {}).then((result) => {
      setBranch(result.ok ? result.value.branch : null)
    })
  }, [revision])

  /**
   * One baseline fetch per file, not per keystroke. Each spawn of git costs
   * about 90ms, and the committed text only changes when the repository does.
   */
  useEffect(() => {
    if (activePath === null) {
      setBaseline(null)
      return
    }
    latestPath.current = activePath
    void window.claven.invoke('git:baseline', { path: activePath }).then((result) => {
      // A slow answer for a file you have since navigated away from must not
      // become the baseline for the file now on screen.
      if (latestPath.current !== activePath) return
      setBaseline({ path: activePath, value: result.ok ? result.value : { state: 'none' } })
    })
  }, [activePath, revision])

  // The diff itself is cheap after the prefix and suffix trim, but running it
  // on every keystroke of a large file is still work nobody asked for.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(content), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [content])

  const changedLines = useMemo(() => {
    if (activePath === null || debounced === null) return undefined
    if (baseline === null || baseline.path !== activePath) return undefined
    if (baseline.value.state === 'none') return { docId: activePath, lines: [] }
    const before = baseline.value.state === 'tracked' ? baseline.value.content : null
    return { docId: activePath, lines: lineChanges(before, debounced) }
  }, [activePath, baseline, debounced])

  return { branch, changedLines }
}
