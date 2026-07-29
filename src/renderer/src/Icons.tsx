/**
 * The Claven icon set — "sigil".
 *
 * Every mark is a fragment of the thing's own grammar rather than a picture of
 * an object: c++ is its two increment crosses, .h is the preprocessor hash,
 * json is a brace pair around a value, rust is the `::` path separator, python
 * is three levels of indentation, java is the class wrapper enclosing a member.
 * No page-with-folded-corner, no manila folder, no gear.
 *
 * MONOCHROME BY NECESSITY, not preference. BRAND.md allows exactly one accent
 * and caps it at ~2% of the screen, so VS Code's approach — a colour per
 * language — is unavailable. These differentiate by shape and inherit
 * currentColor from the row's state (ink / muted / dim).
 *
 * CONSTRUCTION: no strokes anywhere. Every element is a filled rect or path on
 * integer coordinates, so at 16px every horizontal and vertical edge lands on a
 * device-pixel boundary and renders with no fringe. Diagonals are 45° filled
 * bands offset 1.4px horizontally (0.99px perpendicular), which measures as one
 * solid pixel plus a ~30% neighbour — the same apparent weight as the 1px bars.
 * A 1.25px stroke on a 45° line has a 1.77px cross-section and renders visibly
 * bolder than its orthogonal neighbours, which is why strokes were abandoned.
 */
import type { EditorLanguage } from './editor/CodeMirrorEditor'

export type IconKey =
  | 'cpp' | 'header' | 'typescript' | 'tsx' | 'javascript' | 'python' | 'java'
  | 'rust' | 'json' | 'markdown' | 'html' | 'css' | 'text' | 'binary' | 'file'
  | 'folder' | 'folderOpen' | 'explorer' | 'search' | 'run' | 'settings' | 'terminal'

const PATHS: Record<IconKey, React.JSX.Element> = {
  // Two increment crosses: ++. The widest, flattest silhouette in the set,
  // which is right for the type this tree contains most of.
  cpp: (
    <>
      <rect x="2" y="7" width="5" height="1" />
      <rect x="4" y="5" width="1" height="5" />
      <rect x="9" y="7" width="5" height="1" />
      <rect x="11" y="5" width="1" height="5" />
    </>
  ),
  // The preprocessor hash — #include, #pragma once.
  header: (
    <>
      <rect x="5" y="4" width="1" height="8" />
      <rect x="10" y="4" width="1" height="8" />
      <rect x="4" y="5" width="8" height="1" />
      <rect x="4" y="10" width="8" height="1" />
    </>
  ),
  // A colon feeding a chevron: the type annotation. Asymmetric — that is the
  // whole difference from tsx at this size.
  typescript: (
    <>
      <rect x="3" y="5" width="2" height="2" />
      <rect x="3" y="9" width="2" height="2" />
      <path d="M10 4 L14 8 L10 12 L8.6 12 L12.6 8 L8.6 4 Z" />
    </>
  ),
  // An element bracket around a solid core: <▪>. Symmetric, where ts is not.
  tsx: (
    <>
      <path d="M5 5 L2 8 L5 11 L6.4 11 L3.4 8 L6.4 5 Z" />
      <rect x="7" y="7" width="2" height="2" />
      <path d="M11 5 L14 8 L11 11 L9.6 11 L12.6 8 L9.6 5 Z" />
    </>
  ),
  // A fat arrow: =>.
  javascript: (
    <>
      <rect x="2" y="6" width="6" height="1" />
      <rect x="2" y="9" width="6" height="1" />
      <path d="M10 4 L14 8 L10 12 L8.6 12 L12.6 8 L8.6 4 Z" />
    </>
  ),
  // Three rules stepping right: indentation as structure.
  python: (
    <>
      <rect x="2" y="3" width="7" height="1" />
      <rect x="5" y="7" width="7" height="1" />
      <rect x="8" y="11" width="6" height="1" />
    </>
  ),
  // Opposing corner brackets around one node: everything lives inside a class.
  java: (
    <>
      <rect x="3" y="3" width="5" height="1" />
      <rect x="3" y="3" width="1" height="5" />
      <rect x="8" y="12" width="5" height="1" />
      <rect x="12" y="8" width="1" height="5" />
      <rect x="7" y="7" width="2" height="2" />
    </>
  ),
  // The :: path separator. Lightest mark in the set at 16px² of ink.
  rust: (
    <>
      <rect x="5" y="4" width="2" height="2" />
      <rect x="5" y="10" width="2" height="2" />
      <rect x="9" y="4" width="2" height="2" />
      <rect x="9" y="10" width="2" height="2" />
    </>
  ),
  // A brace pair enclosing one value. The 1px waist means it reads closer to
  // [ ▪ ] than { ▪ } at 16px — no icon set distinguishes those at this size.
  json: (
    <>
      <rect x="4" y="4" width="1" height="8" />
      <rect x="5" y="4" width="2" height="1" />
      <rect x="5" y="11" width="2" height="1" />
      <rect x="3" y="7" width="1" height="1" />
      <rect x="11" y="4" width="1" height="8" />
      <rect x="9" y="4" width="2" height="1" />
      <rect x="9" y="11" width="2" height="1" />
      <rect x="12" y="7" width="1" height="1" />
      <rect x="7" y="7" width="2" height="2" />
    </>
  ),
  // The down arrow from the markdown mark. Collides with "download" for
  // non-developers; there is no other monochrome cue once # is spent on .h.
  markdown: (
    <>
      <rect x="7" y="3" width="1" height="8" />
      <path d="M4 8 L7.5 11.5 L11 8 L11 6.6 L7.5 10.1 L4 6.6 Z" />
    </>
  ),
  // An empty tag: < >. Full-height and hollow, where tsx is smaller and cored.
  html: (
    <>
      <path d="M6 4 L2 8 L6 12 L7.4 12 L3.4 8 L7.4 4 Z" />
      <path d="M10 4 L14 8 L10 12 L8.6 12 L12.6 8 L8.6 4 Z" />
    </>
  ),
  // A selector brace with two declarations.
  css: (
    <>
      <rect x="4" y="4" width="1" height="8" />
      <rect x="5" y="4" width="2" height="1" />
      <rect x="5" y="11" width="2" height="1" />
      <rect x="3" y="7" width="1" height="1" />
      <rect x="8" y="6" width="5" height="1" />
      <rect x="8" y="9" width="5" height="1" />
    </>
  ),
  text: (
    <>
      <rect x="3" y="4" width="10" height="1" />
      <rect x="3" y="8" width="10" height="1" />
      <rect x="3" y="12" width="6" height="1" />
    </>
  ),
  binary: (
    <>
      <rect x="2" y="5" width="2" height="2" />
      <rect x="8" y="5" width="2" height="2" />
      <rect x="11" y="5" width="2" height="2" />
      <rect x="2" y="9" width="2" height="2" />
      <rect x="5" y="9" width="2" height="2" />
      <rect x="11" y="9" width="2" height="2" />
    </>
  ),
  file: (
    <>
      <rect x="5" y="5" width="6" height="1" />
      <rect x="5" y="10" width="6" height="1" />
      <rect x="5" y="5" width="1" height="6" />
      <rect x="10" y="5" width="1" height="6" />
    </>
  ),
  // Three-sided brackets whose opening rotates to encode state: closed opens
  // sideways, open opens downward — toward the children below it in the tree.
  folder: (
    <>
      <rect x="4" y="3" width="1" height="10" />
      <rect x="4" y="3" width="7" height="1" />
      <rect x="4" y="12" width="7" height="1" />
    </>
  ),
  folderOpen: (
    <>
      <rect x="3" y="4" width="10" height="1" />
      <rect x="3" y="4" width="1" height="7" />
      <rect x="12" y="4" width="1" height="7" />
    </>
  ),
  explorer: (
    <>
      <rect x="4" y="3" width="1" height="9" />
      <rect x="5" y="5" width="6" height="1" />
      <rect x="5" y="8" width="6" height="1" />
      <rect x="5" y="11" width="6" height="1" />
    </>
  ),
  // A prompt: chevron and underscore. Flat geometry, no rounded joins, which
  // is the same rule the mark itself follows.
  terminal: (
    <>
      <path d="M3 4 L4.3 4 L8 7.5 L4.3 11 L3 11 L6.7 7.5 Z" />
      <rect x="8.5" y="10" width="4.5" height="1" />
    </>
  ),
  search: (
    <>
      <rect x="3" y="3" width="7" height="1" />
      <rect x="3" y="9" width="7" height="1" />
      <rect x="3" y="3" width="1" height="7" />
      <rect x="9" y="3" width="1" height="7" />
      <path d="M9 10 L12.5 13.5 L13.9 13.5 L10.4 10 Z" />
    </>
  ),
  run: <path d="M5 4 L12.5 8 L5 12 Z" />,
  settings: (
    <>
      <rect x="5" y="3" width="1" height="10" />
      <rect x="10" y="3" width="1" height="10" />
      <rect x="4" y="5" width="3" height="3" />
      <rect x="9" y="9" width="3" height="3" />
    </>
  )
}

type Props = { name: IconKey; size?: number; className?: string }

export function Icon({ name, size = 16, className }: Props): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
      // shapeRendering keeps the orthogonal bars from being softened by the
      // renderer's default antialiasing at non-integer scales.
      shapeRendering="crispEdges"
    >
      {PATHS[name]}
    </svg>
  )
}

const BY_EXTENSION: Array<[RegExp, IconKey]> = [
  [/\.(hpp|hh|hxx|h)$/i, 'header'],
  [/\.(cpp|cc|cxx|c)$/i, 'cpp'],
  [/\.(tsx|jsx)$/i, 'tsx'],
  [/\.(ts|mts|cts)$/i, 'typescript'],
  [/\.(js|mjs|cjs)$/i, 'javascript'],
  [/\.(py|pyw|pyi)$/i, 'python'],
  [/\.java$/i, 'java'],
  [/\.rs$/i, 'rust'],
  [/\.(json|jsonc|webmanifest)$/i, 'json'],
  [/\.(md|markdown)$/i, 'markdown'],
  [/\.(html?|xhtml|vue|svelte)$/i, 'html'],
  [/\.(css|scss|less)$/i, 'css'],
  [/\.(exe|out|o|obj|class|pyc|pdb|ilk|dll|so|dylib|d)$/i, 'binary'],
  [/\.(txt|log|csv)$/i, 'text']
]

/**
 * Separate from languageForPath on purpose: that maps .h to cpp so the editor
 * highlights it correctly, but the tree wants .h to look like a header.
 */
export function iconForPath(path: string): IconKey {
  return BY_EXTENSION.find(([pattern]) => pattern.test(path))?.[1] ?? 'file'
}

/** Unused today; kept so a language override in the status bar can drive the icon. */
export function iconForLanguage(language: EditorLanguage): IconKey {
  return language === 'plain' ? 'file' : (language as IconKey)
}
