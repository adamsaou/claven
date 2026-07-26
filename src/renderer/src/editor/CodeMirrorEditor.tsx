import { useEffect, useRef } from 'react'
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
  value: string
  language: EditorLanguage
  onChange: (value: string) => void
  onSave: () => void
  onCursor?: (position: CursorPosition) => void
}

export function CodeMirrorEditor({
  value,
  language,
  onChange,
  onSave,
  onCursor
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

  useEffect(() => {
    if (!host.current) return

    const state = EditorState.create({
      doc: value,
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
        ...languageExtension(language)
      ]
    })

    const instance = new EditorView({ state, parent: host.current })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
    // Rebuilt only when the language changes; `value` is synced below so that
    // typing does not recreate the view and lose the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  useEffect(() => {
    const instance = view.current
    if (!instance) return
    const current = instance.state.doc.toString()
    // Only when the document was replaced from outside (opening a different
    // file). Dispatching on every keystroke would fight the user's cursor.
    if (current !== value) {
      instance.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}
