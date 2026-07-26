import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { oneDark } from '@codemirror/theme-one-dark'

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

export type EditorLanguage = 'typescript' | 'tsx' | 'cpp' | 'java' | 'plain'

export function languageForPath(path: string): EditorLanguage {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'tsx'
  if (lower.endsWith('.ts') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'typescript'
  if (/\.(cpp|cc|cxx|hpp|hh|hxx|c|h)$/.test(lower)) return 'cpp'
  if (lower.endsWith('.java')) return 'java'
  return 'plain'
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
    default:
      return []
  }
}

type Props = {
  value: string
  language: EditorLanguage
  onChange: (value: string) => void
  onSave: () => void
}

export function CodeMirrorEditor({ value, language, onChange, onSave }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Held in refs so the extensions built once on mount always call the latest
  // handler, without tearing down and rebuilding the view on every render.
  const latestChange = useRef(onChange)
  const latestSave = useRef(onSave)
  latestChange.current = onChange
  latestSave.current = onSave

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
        }),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
        oneDark,
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
