import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { classifyBytes, decodeText, normalizeToLf } from './textfile'
import { getWorkspaceRoot, resolveInsideWorkspace } from './workspace'
import { MAX_TEXT_FILE_BYTES } from '../shared/files'
import type { GitBaseline, GitInfo } from '../shared/ipc'

/**
 * Git, by running git.
 *
 * No library. `git` is on the PATH of anyone who has a repo to open, a native
 * binding would be another native module to package, and a pure-JS
 * reimplementation would be a second opinion about what your repository
 * contains. The cost is a process per question, measured here at about 90ms.
 *
 * Everything below was checked against the real binary rather than recalled,
 * because most of the plausible commands are subtly wrong. The notes say which.
 */

/** Long enough for a cold cache, short enough that a wedged git does not wedge the gutter. */
const TIMEOUT_MS = 5000

type Ran = { code: number; out: Buffer; error: string }

/**
 * Arguments as an array, never a shell string.
 *
 * A path can contain spaces, a leading dash, or a quote. Every call below also
 * puts the path after `--` so git cannot read it as an option.
 */
function run(cwd: string, args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true })
    const out: Buffer[] = []
    const error: Buffer[] = []
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => error.push(chunk))
    // git missing from PATH entirely lands here rather than as an exit code.
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, out: Buffer.alloc(0), error: 'git is not installed' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, out: Buffer.concat(out), error: Buffer.concat(error).toString('utf8') })
    })
  })
}

/**
 * Which branch, and whether this is a repo at all.
 *
 * `symbolic-ref --quiet --short HEAD` rather than `rev-parse --abbrev-ref HEAD`.
 * The latter is the one everybody reaches for and it is wrong on a repo with no
 * commits: it exits 128 with "ambiguous argument 'HEAD'" and still prints the
 * literal string HEAD on stdout, so a naive caller shows a branch called HEAD.
 * `symbolic-ref` exits 0 with the real branch name on an unborn branch, and
 * exits 1 with no output when HEAD is detached, which is how the two are told
 * apart.
 */
export async function gitInfo(): Promise<GitInfo> {
  const root = getWorkspaceRoot()
  if (root === null) return { isRepo: false, branch: null }

  const toplevel = await run(root, ['rev-parse', '--show-toplevel'])
  if (toplevel.code !== 0) return { isRepo: false, branch: null }

  const symbolic = await run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (symbolic.code === 0) {
    return { isRepo: true, branch: symbolic.out.toString('utf8').trim() }
  }

  // Detached. The short hash is the only useful thing to show, and showing
  // nothing would read as "not a repo".
  const head = await run(root, ['rev-parse', '--short', 'HEAD'])
  return {
    isRepo: true,
    branch: head.code === 0 ? `detached at ${head.out.toString('utf8').trim()}` : null
  }
}

/**
 * The committed text of one file, as the editor would have read it.
 *
 * Two spawns, and neither builds a revision string out of a user-supplied path:
 * `HEAD:${path}` would let a path containing a colon or a leading dash address
 * something else entirely. `ls-tree` takes the path after `--` and hands back
 * an object id, and `cat-file` takes the object id.
 *
 * Deliberately no `-r`. With it, asking about a directory returns every blob
 * underneath, recursively, and the first record gets silently treated as the
 * answer. Without it a nested file still returns its own blob, so `-r` buys
 * nothing and costs correctness.
 *
 * Dropping `-r` is not on its own enough for directories, which is worth
 * saying because it looks like it is: `ls-tree` on a directory still lists that
 * directory's entries rather than returning a `tree` record for it. The repo
 * root came back as the contents of `.gitattributes`. The stat below is what
 * actually rules directories out.
 */
export async function gitBaseline(requestPath: string): Promise<GitBaseline> {
  const root = getWorkspaceRoot()
  if (root === null) return { state: 'none' }

  const path = await resolveInsideWorkspace(requestPath)

  /**
   * Directories are refused here rather than by inspecting what git says.
   *
   * `ls-tree` on a directory does not return a `tree` record, it LISTS the
   * directory, and the first record is a perfectly ordinary blob. Measured: the
   * repo root came back as the contents of .gitattributes. Checking the type
   * field looks like it covers this and does not. A stat is one syscall and
   * unambiguous.
   *
   * A path that does not exist is allowed through: a tracked file deleted from
   * the worktree still has a baseline, and refusing it here would be refusing a
   * real answer.
   */
  const stats = await stat(path).catch(() => null)
  if (stats !== null && stats.isDirectory()) return { state: 'none' }

  const listed = await run(root, ['ls-tree', '-l', '-z', '--full-name', 'HEAD', '--', path])
  // Outside the repo, no commits yet, or not a repo: no baseline to show.
  if (listed.code !== 0) return { state: 'none' }

  const record = listed.out.toString('utf8').split('\0')[0] ?? ''
  // Empty stdout with exit 0 is how git reports "not in the index". The exit
  // code is not the signal, which is the trap in this command.
  if (record === '') return { state: 'untracked' }

  // "<mode> SP <type> SP <oid> SP<padded size> TAB <path>"
  const [meta] = record.split('\t')
  const fields = (meta ?? '').split(/\s+/).filter((field) => field !== '')
  const type = fields[1]
  const oid = fields[2]
  const size = Number(fields[3] ?? '0')
  // A tree is a directory and a commit is a submodule. Neither has text, and
  // cat-file on a submodule's oid fails rather than returning anything useful.
  if (type !== 'blob' || oid === undefined) return { state: 'none' }
  if (Number.isFinite(size) && size > MAX_TEXT_FILE_BYTES) return { state: 'none' }

  const blob = await run(root, ['cat-file', 'blob', oid])
  if (blob.code !== 0) return { state: 'none' }

  /**
   * The same pipeline `fs:read` puts the file through, and that is the whole
   * point rather than a convenience.
   *
   * `cat-file` returns the object database bytes with no filter applied. Two
   * consequences, both measured against this repo's own fixtures. The bytes are
   * whatever was committed, so a file marked `-text` in .gitattributes keeps
   * CRLF, and the editor buffer is always LF: without normalising, every line
   * of an unmodified file reads as changed. And git knows nothing about
   * encoding, so a UTF-16 file decoded as UTF-8 is mojibake and a UTF-8 BOM
   * becomes a permanent modification on line 1.
   *
   * `git cat-file --filters` and `git checkout-index` are the wrong fix for the
   * first half: they apply the smudge filter and hand back the worktree
   * endings, which is the opposite of what is wanted.
   */
  const classified = classifyBytes(blob.out)
  if (classified.kind === 'binary') return { state: 'none' }
  return {
    state: 'tracked',
    content: normalizeToLf(decodeText(classified.body, classified.encoding))
  }
}
