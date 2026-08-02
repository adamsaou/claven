import { useEffect, useRef, useState } from 'react'
import type { SearchDone, SearchMatch, SearchQuery } from '../../shared/search'

/**
 * Everything stateful about a search run, so the panel stays close to
 * declarative.
 *
 * Results arrive as a stream of batches, which means two things have to be got
 * right or the panel lies. Every payload is filtered by run id, because
 * cancelling a run cannot recall a batch already on the wire and a late batch
 * from the previous query would otherwise append to the new one's results. And
 * the current id lives in a ref rather than in state, so the filter can never
 * read a stale closure.
 */

export type SearchGroup = { file: string; matches: SearchMatch[] }

export type SearchState = {
  running: boolean
  groups: SearchGroup[]
  matchCount: number
  filesSearched: number
  done: SearchDone | null
  error: string | null
}

const IDLE: SearchState = {
  running: false,
  groups: [],
  matchCount: 0,
  filesSearched: 0,
  done: null,
  error: null
}

/** Long enough not to search on every keystroke, short enough to feel live. */
const DEBOUNCE_MS = 180

export function useSearch(query: SearchQuery, root: string | null): SearchState {
  const [state, setState] = useState<SearchState>(IDLE)
  const runId = useRef<string | null>(null)
  /** Insertion-ordered, so files stay in the order main walked them. */
  const groups = useRef(new Map<string, SearchMatch[]>())

  useEffect(() => {
    const offMatches = window.claven.subscribe('search:matches', (payload) => {
      if (payload.id !== runId.current) return
      for (const match of payload.matches) {
        const existing = groups.current.get(match.file)
        if (existing === undefined) groups.current.set(match.file, [match])
        else existing.push(match)
      }
      setState((current) => ({
        ...current,
        filesSearched: payload.filesSearched,
        matchCount: current.matchCount + payload.matches.length,
        // Rebuilt rather than mutated, because React compares by identity and a
        // mutated array renders nothing.
        groups: [...groups.current].map(([file, matches]) => ({ file, matches }))
      }))
    })

    const offDone = window.claven.subscribe('search:done', (payload) => {
      if (payload.id !== runId.current) return
      const { id: _id, ...done } = payload
      setState((current) => ({ ...current, running: false, done }))
    })

    return () => {
      offMatches()
      offDone()
    }
  }, [])

  useEffect(() => {
    const cancelCurrent = (): void => {
      if (runId.current === null) return
      void window.claven.invoke('search:cancel', { id: runId.current })
      runId.current = null
    }

    if (query.pattern.length === 0 || root === null) {
      cancelCurrent()
      groups.current.clear()
      setState(IDLE)
      return
    }

    const timer = setTimeout(() => {
      cancelCurrent()
      groups.current.clear()
      setState({ ...IDLE, running: true })
      void window.claven.invoke('search:start', { query }).then((result) => {
        if (!result.ok) {
          setState({ ...IDLE, running: false, error: result.error.message })
          return
        }
        runId.current = result.value.id
      })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // Compared by value: the query object is rebuilt on every render, so using
    // it directly would restart the search on every keystroke of any other
    // field on the page.
    // `query` is compared by identity here on purpose: SearchPanel already
    // memoises it, including a key over the unsaved buffers, so a new object
    // means a genuinely different question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, root])

  // A run against a workspace the user has left is worse than useless.
  useEffect(
    () =>
      window.claven.subscribe('workspace:changed', () => {
        if (runId.current !== null) {
          void window.claven.invoke('search:cancel', { id: runId.current })
          runId.current = null
        }
        groups.current.clear()
        setState(IDLE)
      }),
    []
  )

  return state
}
