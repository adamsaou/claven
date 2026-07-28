import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { rust } from '@codemirror/lang-rust'
import { clavenDark } from './clavenDark'

/**
 * THE ADAPTER. This is the only file in the app permitted to import
 * @codemirror/view -- enforced by eslint no-restricted-imports.
 *
 * Everything else talks to the editor through the props below. That rule is
 * what keeps "replace the renderer later" a real option instead of an
 * aspiration: without it the seam decays within a month of M3, because
 * Decoration, WidgetType and ViewPlugin all live on the view side and every
 * feature that draws would reach across.
 */

export type EditorLanguage =
  | 'typescript' | 'tsx' | 'cpp' | 'java' | 'python'
  | 'json' | 'markdown' | 'html' | 'css' | 'rust' | 'plain'

/**
 * Extension -> grammar. Python was missing on day one because the language list
 * came from the plan (React/TS, competitive C++, FTC Java) rather than from what
 * is actually in ~/DEVELOPEMENT. Add to this the moment a real file opens plain.
 */
const BY_EXTENSION: Array<[RegExp, EditorLanguage]> = [
  [/\.(tsx|jsx)$/, 'tsx'],
  [/\.(ts|mts|cts|js|mjs|cjs)$/, 'typescript'],
  [/\.(cpp|cc|cxx|hpp|hh|hxx|c|h)$/, 'cpp'],
  [/\.java$/, 'java'],
  [/\.(py|pyw|pyi)$/, 'python'],
  [/\.(json|jsonc|webmanifest)$/, 'json'],
  [/\.(md|markdown)$/, 'markdown'],
  [/\.(html?|xhtml|vue|svelte)$/, 'html'],
  [/\.(css|scss|less)$/, 'css'],
  [/\.rs$/, 'rust']
]

export function languageForPath(path: string): EditorLanguage {
  const lower = path.toLowerCase()
  return BY_EXTENSION.find(([pattern]) => pattern.test(lower))?.[1] ?? 'plain'
}

function languageExtension(language: EditorLanguage): Extension[] {
  switch (language) {
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'typescript':
      return [javascript({ typescript: true })]
    case 'cpp':
      return [cpp()]
    case 'java':
      return [java()]
    case 'python':
      return [python()]
    case 'json':
      return [json()]
    case 'markdown':
      return [markdown()]
    case 'html':
      return [html()]
    case 'css':
      return [css()]
    case 'rust':
      return [rust()]
    default:
      return []
  }
}

/** Where the cursor is, in the 1-based terms a status bar shows. */
export type CursorPosition = { line: number; column: number; selected: number }

type Props = {
  /** Identity of the document on screen — the file path. Switching this swaps documents. */
  docId: string
  value: string
  language: EditorLanguage
  /** Every open document. State cached for anything not listed here is dropped. */
  openDocIds: string[]
  onChange: (value: string) => void
  onSave: () => void
  onCursor?: (position: CursorPosition) => void
  /** Where to place the cursor the first time a document is opened. */
  initialCursor?: { line: number; column: number }
}

/** What has to survive a tab switch. Scroll is not part of EditorState, so it rides along. */
type Cached = { state: EditorState; scrollTop: number }

export function CodeMirrorEditor({
  docId,
  value,
  language,
  openDocIds,
  onChange,
  onSave,
  onCursor,
  initialCursor
}: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Held in refs so the extensions built once on mount always call the latest
  // handler, without tearing down and rebuilding the view on every render.
  const latestChange = useRef(onChange)
  const latestSave = useRef(onSave)
  const latestCursor = useRef(onCursor)
  latestChange.current = onChange
  latestSave.current = onSave
  latestCursor.current = onCursor

  /**
   * One EditorState per open file, and one view that swaps between them.
   *
   * The obvious implementation — a React `key` on the path, so switching tabs
   * remounts the editor — throws away undo history, selection, scroll position
   * and folds every single time. Switching to another file to check something
   * and coming back to a dead ctrl+z is the kind of thing you stop noticing and
   * start working around, which is worse.
   */
  const cache = useRef(new Map<string, Cached>())
  /** Which document the live view currently holds. */
  const mounted = useRef<string | null>(null)

  const buildState = useCallback(
    (doc: string, forLanguage: EditorLanguage): EditorState =>
      EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          // Fallback only — clavenDark's HighlightStyle takes precedence for any
          // tag it defines. This keeps unstyled tags from rendering flat.
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          // Per-line base direction. This is the whole reason Arabic and Hebrew
          // render correctly here and do not in Zed (RTL tracking issue: 2 of 52
          // subtasks done after 14 months) or VS Code (#11770, open since 2016).
          // CodeMirror already ships the Unicode Bidi Algorithm; this turns it on
          // per line instead of forcing one direction on the whole document.
          EditorView.perLineTextDirection.of(true),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                latestSave.current()
                return true
              }
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latestChange.current(update.state.doc.toString())
            if (update.docChanged || update.selectionSet) {
              const range = update.state.selection.main
              const line = update.state.doc.lineAt(range.head)
              latestCursor.current?.({
                line: line.number,
                // Editors count columns from 1, and the doc indexes from 0.
                column: range.head - line.from + 1,
                selected: Math.abs(range.to - range.from)
              })
            }
          }),
          clavenDark,
          ...languageExtension(forLanguage)
        ]
      }),
    []
  )

  /** Put the cursor where the session left it, clamped — the file may have shrunk since. */
  const placeCursor = useCallback((instance: EditorView, at: { line: number; column: number }) => {
    const line = instance.state.doc.line(Math.min(Math.max(at.line, 1), instance.state.doc.lines))
    const position = Math.min(line.from + at.column - 1, line.to)
    instance.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'center' })
    })
  }, [])

  // The view is built once and lives for as long as the editor is on screen.
  // Layout effects, both this and the swap below: a passive effect would let
  // the browser paint one frame of an empty, unstyled editor first.
  useLayoutEffect(() => {
    if (!host.current) return
    const instance = new EditorView({ parent: host.current })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
      mounted.current = null
      cache.current.clear()
    }
  }, [])

  // Swap documents. Declared before the value sync below so that on a tab
  // change the new document is in place before anything checks its contents.
  useLayoutEffect(() => {
    const instance = view.current
    if (!instance || mounted.current === docId) return

    // Park the outgoing document before touching the view.
    if (mounted.current !== null) {
      cache.current.set(mounted.current, {
        state: instance.state,
        scrollTop: instance.scrollDOM.scrollTop
      })
    }

    const cached = cache.current.get(docId)
    instance.setState(cached?.state ?? buildState(value, language))
    mounted.current = docId

    if (cached === undefined) {
      cache.current.set(docId, { state: instance.state, scrollTop: 0 })
      if (initialCursor !== undefined) placeCursor(instance, initialCursor)
      return
    }

    // Restoring scroll needs the heights measured. Set it now for the common
    // case and again after the measure, which is what actually lands.
    const top = cached.scrollTop
    instance.scrollDOM.scrollTop = top
    const frame = requestAnimationFrame(() => {
      if (view.current === instance && mounted.current === docId) instance.scrollDOM.scrollTop = top
    })
    return () => cancelAnimationFrame(frame)
    // initialCursor is read only when a document is opened for the first time;
    // listing it would re-run this on every cursor move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, language, buildState, placeCursor])

  useEffect(() => {
    const instance = view.current
    if (!instance || mounted.current !== docId) return
    const current = instance.state.doc.toString()
    // Only when the document was replaced from outside — a reload from disk.
    // Dispatching on every keystroke would fight the user's cursor.
    if (current !== value) {
      instance.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value, docId])

  // Drop the state of files that are no longer open, so a long session does not
  // hold every document it has ever shown.
  const openKey = openDocIds.join('\n')
  useEffect(() => {
    const live = new Set(openKey.length === 0 ? [] : openKey.split('\n'))
    for (const key of cache.current.keys()) {
      if (!live.has(key) && key !== mounted.current) cache.current.delete(key)
    }
  }, [openKey])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}
