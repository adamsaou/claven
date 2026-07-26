import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/**
 * "Claven Dark" — the syntax theme from brand/BRAND.md section 2.
 *
 * Every value here is quoted from the brand guide. If a token is needed that
 * the guide does not define, it goes in the guide first. Ember is load-bearing
 * and scarce: it is the cursor and keywords, nothing else in the editor.
 */
const OBSIDIAN = '#0F1115'
const SURFACE_1 = '#16191F'
const SURFACE_2 = '#1E222A'
const LINE = '#2A2F39'
const TEXT = '#E8E6E1'
const EMBER = '#FF5A2B'

/**
 * Selection — brand/BRAND.md section 2. The next step on the surface ramp
 * (obsidian → surface 1 → surface 2 → line → selection), measuring 1.92:1
 * against obsidian.
 *
 * The guide originally specified `#1E222A`, which measures 1.19:1 and is
 * perceptually invisible; it was corrected in the guide rather than worked
 * around here, so the two cannot drift apart.
 */
const SELECTION = '#3D424C'

const SYNTAX = {
  comment: '#6B7280',
  keyword: EMBER,
  string: '#5FBF7A',
  number: '#F0B429',
  function: '#5AD1E6',
  type: '#C8A2FF',
  variable: TEXT,
  lineNumber: '#3A4049',
  selection: SELECTION
}

const theme = EditorView.theme(
  {
    '&': {
      color: TEXT,
      backgroundColor: OBSIDIAN,
      height: '100%',
      // Brand type scale: code is 13.5px / 1.65.
      fontSize: '13.5px'
    },
    '.cm-content': {
      caretColor: EMBER,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace",
      lineHeight: '1.65'
    },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },

    // Cursor is ember and 2px — it is one of the few places the accent is spent.
    '.cm-cursor, .cm-dropCursor': { borderLeft: `2px solid ${EMBER}` },

    // The child combinators are load-bearing, not decoration.
    //
    // CodeMirror's base theme ships
    //   &dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
    // which is FIVE class selectors. A descendant-combinator version of the
    // same rule is four, loses on specificity, and the base theme's #233 wins —
    // which on obsidian is invisible. Match its shape exactly or lose silently.
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: SYNTAX.selection },
    // Unfocused selection recedes but stays visible, so you can still see what
    // is selected while the cursor is in the tree or the status bar.
    '&:not(.cm-focused) > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: '#2A3040'
    },
    '.cm-selectionMatch': { backgroundColor: LINE },

    '.cm-gutters': {
      backgroundColor: OBSIDIAN,
      color: SYNTAX.lineNumber,
      // 1px borders, no shadows in product chrome.
      borderRight: `1px solid ${LINE}`
    },
    // The gutter is opaque — nothing is ever selected there.
    '.cm-activeLineGutter': { backgroundColor: SURFACE_1, color: TEXT },
    // The line itself must NOT be. .cm-selectionLayer sits at z-index -1,
    // behind the content, so an opaque active-line background paints straight
    // over the selection — and the active line is by definition the line you
    // are selecting in. A translucent lift reads the same and lets it through.
    '.cm-activeLine': { backgroundColor: 'rgba(232, 230, 225, 0.035)' },
    '.cm-foldPlaceholder': {
      backgroundColor: SURFACE_2,
      border: `1px solid ${LINE}`,
      color: SYNTAX.comment
    },

    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: SURFACE_2,
      outline: `1px solid ${LINE}`
    },
    '.cm-nonmatchingBracket': { color: '#E5484D' },

    // ctrl+f opens CodeMirror's search panel. Theming only .cm-panels left the
    // input and buttons on CodeMirror's own defaults — a half-branded panel.
    '.cm-panels': { backgroundColor: SURFACE_1, color: TEXT, borderTop: `1px solid ${LINE}` },
    '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: "'IBM Plex Sans', sans-serif" },
    '.cm-panel.cm-search label': { fontSize: '11px', color: '#9AA0AA' },
    '.cm-textfield': {
      backgroundColor: SURFACE_2,
      border: `1px solid ${LINE}`,
      borderRadius: '2px',
      color: TEXT,
      padding: '2px 6px',
      fontSize: '12px'
    },
    '.cm-textfield:focus': { outline: `1px solid ${EMBER}`, outlineOffset: '-1px' },
    '.cm-button': {
      backgroundColor: SURFACE_2,
      backgroundImage: 'none',
      border: `1px solid ${LINE}`,
      borderRadius: '2px',
      color: TEXT,
      padding: '2px 8px',
      fontSize: '12px'
    },
    '.cm-button:hover': { backgroundColor: LINE },
    '.cm-panel.cm-search [name="close"]': { color: '#9AA0AA', fontSize: '16px' },
    '.cm-searchMatch': { backgroundColor: SURFACE_2, outline: `1px solid ${LINE}` },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: EMBER, color: OBSIDIAN },

    '.cm-tooltip': {
      backgroundColor: SURFACE_2,
      border: `1px solid ${LINE}`,
      borderRadius: '4px'
    }
  },
  { dark: true }
)

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: SYNTAX.comment, fontStyle: 'italic' },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self, t.null],
    color: SYNTAX.keyword
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: SYNTAX.string },
  { tag: [t.number, t.integer, t.float, t.bool, t.literal], color: SYNTAX.number },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: SYNTAX.function },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.annotation], color: SYNTAX.type },
  { tag: [t.variableName, t.propertyName, t.attributeName, t.definition(t.variableName)], color: SYNTAX.variable },

  // Not specified by the brand guide, so kept deliberately neutral rather than
  // invented — punctuation and operators recede so ember stays scarce.
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: '#9AA0AA' },
  { tag: [t.meta, t.processingInstruction], color: SYNTAX.comment },
  { tag: t.invalid, color: '#E5484D' },
  { tag: [t.heading, t.strong], fontWeight: '600', color: TEXT },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#5AD1E6', textDecoration: 'underline' }
])

export const clavenDark: Extension = [theme, syntaxHighlighting(highlight)]
