/**
 * A line diff, for the gutter.
 *
 * Pure and in `shared` for the same reason the layout is: it can be tested
 * directly rather than by driving a window, and the main process can check it
 * without a renderer.
 *
 * **It diffs the buffer, not the file.** The gutter has to move as you type,
 * which is the entire point of having one. Diffing what is on disk would mean
 * the marks describe your last save, and search had exactly that bug until it
 * was fixed: right for the files you are not looking at, wrong for the one you
 * are.
 */

export type ChangeKind = 'added' | 'modified' | 'removed'

export type LineChange = {
  /**
   * 1-based, in the CURRENT buffer's coordinates, which is what a gutter draws.
   *
   * For `removed` this is the line the deleted content sat AFTER, because there
   * is no line to point at any more. A gutter draws that as a wedge on the
   * lower edge of the line, which is where the missing text used to be. A
   * deletion from the very top reports line 1, meaning "above this".
   */
  line: number
  kind: ChangeKind
}

/**
 * Above this many lines in the changed region, the diff gives up and calls the
 * whole region modified.
 *
 * The comparison is quadratic once the common prefix and suffix are gone, and a
 * gutter is not worth a frozen editor. In practice the trimmed region is a
 * handful of lines, because that is what editing a file looks like. The cap
 * only bites on things like a reformat of a large file, where "all of it
 * changed" is also the true answer.
 */
const MAX_REGION = 2000

function splitLines(text: string): string[] {
  /**
   * Split on CRLF, CR or LF, not on LF alone.
   *
   * The buffer is always LF: the file layer normalises on read. The baseline is
   * not, because git hands back the object database bytes and a file marked
   * `-text` or `binary` in .gitattributes keeps whatever endings it was
   * committed with. This repo does exactly that to tests/fixtures.
   *
   * Measured against the real committed bytes of those fixtures: a CRLF
   * baseline against its own unmodified buffer reported every line modified,
   * and a lone-CR baseline collapsed to one line and reported a shape that
   * sends you into the diff algorithm rather than into the encoding. Main
   * normalises the baseline as well, so this is the second line of defence
   * rather than the only one, but a whole file lit up looks like a fetch bug
   * and would be debugged as one.
   *
   * It is also the split CodeMirror itself uses, so the line numbering agrees
   * with the editor's by construction.
   */
  const lines = text.split(/\r\n?|\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Longest common subsequence over lines, as a mapping from old index to new.
 *
 * Straightforward dynamic programming. Called only on the region left after
 * common prefix and suffix are trimmed, and only when that region is small.
 */
function commonSubsequence(before: string[], after: string[]): Array<[number, number]> {
  const rows = before.length
  const columns = after.length
  const table: Uint32Array = new Uint32Array((rows + 1) * (columns + 1))
  const at = (row: number, column: number): number => row * (columns + 1) + column

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[at(row, column)] =
        before[row] === after[column]
          ? (table[at(row + 1, column + 1)] ?? 0) + 1
          : Math.max(table[at(row + 1, column)] ?? 0, table[at(row, column + 1)] ?? 0)
    }
  }

  const pairs: Array<[number, number]> = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      pairs.push([row, column])
      row += 1
      column += 1
    } else if ((table[at(row + 1, column)] ?? 0) >= (table[at(row, column + 1)] ?? 0)) {
      row += 1
    } else {
      column += 1
    }
  }
  return pairs
}

/**
 * What changed, in the current buffer's line numbers.
 *
 * `before` is the committed text. A null means the file is not in the index at
 * all, which is a different statement from "identical": every line of a new
 * file is added, and saying so is the useful answer.
 */
export function lineChanges(before: string | null, after: string): LineChange[] {
  const next = splitLines(after)
  if (before === null) {
    return next.map((_line, index) => ({ line: index + 1, kind: 'added' as const }))
  }

  const previous = splitLines(before)

  // Trim what is identical at each end. This is what keeps the comparison cheap
  // on a real file, where an edit touches a few lines out of a thousand.
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) {
    start += 1
  }
  let endBefore = previous.length
  let endAfter = next.length
  while (
    endBefore > start &&
    endAfter > start &&
    previous[endBefore - 1] === next[endAfter - 1]
  ) {
    endBefore -= 1
    endAfter -= 1
  }

  const oldRegion = previous.slice(start, endBefore)
  const newRegion = next.slice(start, endAfter)
  if (oldRegion.length === 0 && newRegion.length === 0) return []

  const changes: LineChange[] = []

  // Only new lines: pure insertion.
  if (oldRegion.length === 0) {
    for (let index = 0; index < newRegion.length; index += 1) {
      changes.push({ line: start + index + 1, kind: 'added' })
    }
    return changes
  }
  // Only old lines: pure deletion, marked at the line that now sits there.
  if (newRegion.length === 0) {
    return [{ line: Math.max(1, start), kind: 'removed' }]
  }

  if (oldRegion.length > MAX_REGION || newRegion.length > MAX_REGION) {
    for (let index = 0; index < newRegion.length; index += 1) {
      changes.push({ line: start + index + 1, kind: 'modified' })
    }
    return changes
  }

  const pairs = commonSubsequence(oldRegion, newRegion)

  let oldCursor = 0
  let newCursor = 0
  const emitGap = (oldUntil: number, newUntil: number): void => {
    const removed = oldUntil - oldCursor
    const added = newUntil - newCursor
    if (removed === 0 && added === 0) return

    if (added === 0) {
      // Lines went and nothing replaced them. Marked on the line that now
      // occupies the position, or the first line when they went from the top.
      changes.push({ line: Math.max(1, start + newCursor), kind: 'removed' })
      return
    }
    // Anything that replaced something is modified; the rest is new.
    for (let index = 0; index < added; index += 1) {
      changes.push({
        line: start + newCursor + index + 1,
        kind: index < removed ? 'modified' : 'added'
      })
    }
    /**
     * More went than arrived, so lines vanished with nothing standing in for
     * them. Without this they are silent: replacing five lines with one
     * reported a single modified line and said nothing about the four that
     * went, which is the one thing a gutter exists to tell you.
     */
    if (removed > added) {
      changes.push({ line: start + newCursor + added, kind: 'removed' })
    }
  }

  for (const [oldIndex, newIndex] of pairs) {
    emitGap(oldIndex, newIndex)
    oldCursor = oldIndex + 1
    newCursor = newIndex + 1
  }
  emitGap(oldRegion.length, newRegion.length)

  return changes
}
