/**
 * File-shaped types shared by main and renderer.
 *
 * The guiding rule: the editor works in LF internally, always. What was on disk
 * is recorded in FileMeta and restored on save. Normalizing on read and
 * denormalizing on write is the only way a cross-platform editor avoids turning
 * one keystroke into a whole-file diff, and it is why `lineEnding` travels with
 * the content everywhere instead of being guessed again at save time.
 */

/** What separated the lines on disk. */
export type LineEnding = 'lf' | 'crlf' | 'cr'

/**
 * How the bytes were encoded. utf8bom is tracked separately from utf8 because
 * silently dropping or adding a BOM changes the file, and something downstream
 * always cares -- a shell script stops running, a JSON parser stops parsing.
 * (This project hit exactly that on 2026-07-26; see ANNOYANCES.md.)
 */
export type TextEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be'

export type FileMeta = {
  path: string
  encoding: TextEncoding
  /** The dominant ending, which is what a save writes. */
  lineEnding: LineEnding
  /**
   * The file already mixed endings before we touched it. Worth surfacing rather
   * than silently normalizing, because saving will make the file consistent and
   * that shows up as a large diff the user did not ask for.
   */
  mixedLineEndings: boolean
  /**
   * Whether the file ended with a newline when it was opened. Informational —
   * a save writes whatever the buffer holds, so the user's edit wins. Adding or
   * removing a trailing newline is a real diff, and a real one to be allowed to
   * make.
   */
  hadTrailingNewline: boolean
  /** Used to detect that the file changed underneath us before we overwrite it. */
  mtimeMs: number
  size: number
}

/**
 * Reading can legitimately decline. A 900 MB log or a PNG opened by accident
 * should produce a clear answer rather than a hang or a screenful of mojibake.
 */
export type ReadResult =
  | { kind: 'text'; content: string; meta: FileMeta }
  | { kind: 'binary'; path: string; size: number }
  | { kind: 'too-large'; path: string; size: number; limit: number }

export type DirEntry = {
  name: string
  path: string
  kind: 'file' | 'directory'
  /** Reported so the tree can mark them; never followed out of the workspace. */
  isSymlink: boolean
}

/** Files above this are refused rather than loaded into the renderer heap. */
export const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024

export const LINE_ENDING_CHARS: Record<LineEnding, string> = {
  lf: '\n',
  crlf: '\r\n',
  cr: '\r'
}
