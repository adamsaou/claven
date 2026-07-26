/**
 * Subsequence fuzzy matching for the command palette.
 *
 * Hand-rolled rather than a dependency: this is the whole algorithm, it has no
 * edge cases worth outsourcing, and a command palette's feel comes from the
 * scoring weights — which you end up tuning by hand anyway, so owning them is
 * the point.
 *
 * Scoring, in order of weight:
 *   - a match at a word boundary is worth far more than one mid-word, so
 *     "otf" hits "open the folder" rather than "sort file"
 *   - consecutive matches compound, so a typed prefix beats scattered letters
 *   - an earlier first match wins ties, so short titles surface first
 */

export type Match = {
  score: number
  /** Indices in the haystack that matched, for highlighting. */
  positions: number[]
}

const WORD_BOUNDARY = /[\s\-_/\\.:]/

export function fuzzyMatch(needle: string, haystack: string): Match | null {
  if (needle.length === 0) return { score: 0, positions: [] }

  const lowerNeedle = needle.toLowerCase()
  const lowerHay = haystack.toLowerCase()

  const positions: number[] = []
  let score = 0
  let hayIndex = 0
  let consecutive = 0

  for (let i = 0; i < lowerNeedle.length; i += 1) {
    const char = lowerNeedle[i]
    if (char === undefined || char === ' ') continue

    const found = lowerHay.indexOf(char, hayIndex)
    if (found === -1) return null

    const previous = found > 0 ? haystack[found - 1] : undefined
    const atWordStart = found === 0 || (previous !== undefined && WORD_BOUNDARY.test(previous))
    // An uppercase letter inside a word is also a boundary: "cT" hits "closeTab".
    const atCamelHump =
      previous !== undefined && previous === previous.toLowerCase() && haystack[found] !== lowerHay[found]

    consecutive = found === hayIndex && i > 0 ? consecutive + 1 : 0

    score += 1
    if (atWordStart) score += 8
    else if (atCamelHump) score += 6
    score += consecutive * 4

    positions.push(found)
    hayIndex = found + 1
  }

  // Earlier first match wins ties; shorter haystacks win the remainder.
  score -= (positions[0] ?? 0) * 0.3
  score -= haystack.length * 0.05

  return { score, positions }
}

export type Ranked<T> = { item: T; match: Match }

export function rank<T>(query: string, items: T[], key: (item: T) => string): Ranked<T>[] {
  const results: Ranked<T>[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, key(item))
    if (match !== null) results.push({ item, match })
  }
  // Stable within equal scores, so an empty query preserves the caller's order.
  return results.sort((a, b) => b.match.score - a.match.score)
}
