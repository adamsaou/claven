/**
 * Search types and limits, shared by main and renderer.
 *
 * Positions are 1-based line and column in **UTF-16 code units** over
 * LF-normalized text. That is not a preference, it is the only coordinate space
 * the renderer can act on: the editor computes its status bar column as
 * `head - line.from + 1` over the document `fs:read` returned, which is already
 * normalized, and the cursor restore inverts exactly `{ line, column }`.
 *
 * A byte offset would be wrong by one per preceding line in a CRLF file, by up
 * to three per non-ASCII character in UTF-8, and by a factor of two in UTF-16.
 * Code points would disagree with the editor on anything outside the basic
 * plane: one grapheme fixture line is 14 code units and 12 code points.
 */

export type SearchQuery = {
  /** A literal unless `regex` is set. */
  pattern: string
  /**
   * null is smart case: sensitive only when the pattern contains an uppercase
   * letter. true and false are the explicit toggle.
   */
  caseSensitive: boolean | null
  wholeWord: boolean
  regex: boolean
}

export type SearchMatch = {
  /** Workspace-relative, forward slashes. The same shape `fs:walk` returns. */
  file: string
  /** 1-based, over LF-normalized text, so it agrees with the gutter. */
  line: number
  /** 1-based, UTF-16 code units from the start of the line. */
  column: number
  /** Length of the hit, in UTF-16 code units. */
  length: number
  /** The matched line, left-trimmed and clipped to a window around the hit. */
  preview: string
  /** How many code units `preview` drops from the front of the line. */
  previewFrom: number
}

/** Why files were passed over. Counted so the footer can say, never silent. */
export type SearchSkipped = {
  binary: number
  tooLarge: number
  unreadable: number
  /** Files with at least one line over MAX_LINE_LENGTH, not a count of lines. */
  longLine: number
}

export type SearchDone = {
  reason: 'complete' | 'limit' | 'cancelled'
  filesSearched: number
  matchCount: number
  skipped: SearchSkipped
  /**
   * CR was removed from a literal pattern, or a regex contains one. The haystack
   * is LF-normalized so a pattern containing CR can never match, and on a
   * machine where most files are CRLF, pasting two lines out of a browser and
   * getting silence is a bug rather than a subtlety.
   */
  crStripped: boolean
  elapsedMs: number
}

/** A whole run stops here. Ten thousand rows is already more than anyone reads. */
export const MAX_MATCHES = 10_000

/**
 * Lines longer than this are not scanned. A hit at column 41,000 of a minified
 * bundle has no useful preview and the row is noise.
 */
export const MAX_LINE_LENGTH = 1_000

/** How much of a matched line to send, and how much of it to keep before the hit. */
export const PREVIEW_MAX = 200
export const PREVIEW_LEAD = 40

/** Flushed on whichever comes first, so results appear without a wakeup per match. */
export const BATCH_MATCHES = 200
export const BATCH_MS = 50
