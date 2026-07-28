export const REPO = 'adamsaou/claven'
export const REPO_URL = `https://github.com/${REPO}`

/**
 * Last known good, used when the build machine is offline or GitHub is having a
 * day. The number on screen is then corrected in the browser, so the worst case
 * is a stale figure rather than a missing one.
 */
export const FALLBACK_COMMIT_COUNT = 22

/**
 * Total commits, without downloading the history.
 *
 * Asking for one commit per page makes the last page number the total, and
 * GitHub puts it in the Link header. One request, no token, no pagination —
 * and `Link` is in the API's Access-Control-Expose-Headers, so the same trick
 * works from the browser.
 */
export function commitCountFromLinkHeader(link: string | null): number | null {
  if (link === null) return null
  const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(link)
  if (last?.[1] === undefined) return null
  const count = Number.parseInt(last[1], 10)
  return Number.isFinite(count) && count > 0 ? count : null
}

/** Build-time lookup. Never throws: a website that will not build without the
 *  network is a website that will not build on a train. */
export async function fetchCommitCount(): Promise<number> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=1`, {
      headers: { accept: 'application/vnd.github+json' }
    })
    if (!response.ok) return FALLBACK_COMMIT_COUNT
    // A repo with a single commit has no "last" link, and one commit is the
    // honest answer there.
    return commitCountFromLinkHeader(response.headers.get('link')) ?? 1
  } catch {
    return FALLBACK_COMMIT_COUNT
  }
}
