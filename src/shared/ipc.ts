/**
 * The single source of truth for main <-> renderer traffic.
 *
 * Everything else in the IPC layer derives from `IpcContract`. Add a channel
 * here and the compiler forces you to (a) add it to IPC_CHANNELS below, or the
 * preload allowlist rejects it at runtime, and (b) register a handler in main,
 * or startup fails loudly. Both failures happen immediately instead of the
 * first time a user clicks the thing.
 */
import type { DirEntry, FileMeta, ReadResult } from './files'
import type { LayoutNode } from './layout'
import type { SearchDone, SearchMatch, SearchQuery } from './search'

export type IpcContract = {
  /**
   * The proving channel. Exists to demonstrate the contract works end to end
   * before anything is built on top of it, and stays as a liveness check.
   */
  'app:ping': {
    request: { sentAt: number }
    response: {
      sentAt: number
      receivedAt: number
      pid: number
      versions: { electron: string; chrome: string; node: string; v8: string }
    }
  }

  /** Prompt for a folder. The only way a workspace root is ever set. */
  'workspace:open': {
    request: Record<string, never>
    response: { root: string | null }
  }

  'workspace:current': {
    request: Record<string, never>
    response: { root: string | null }
  }

  /** List one directory. The tree loads lazily; nothing walks the whole repo. */
  'fs:list': {
    request: { path: string }
    response: { entries: DirEntry[] }
  }

  'fs:read': {
    request: { path: string }
    response: ReadResult
  }

  /**
   * Write with the original encoding, line endings and trailing-newline state
   * restored from `meta`. `expectedMtimeMs` guards against clobbering a change
   * made outside the editor; pass null to overwrite deliberately.
   */
  'fs:write': {
    request: { path: string; content: string; meta: FileMeta; expectedMtimeMs: number | null }
    response: { meta: FileMeta }
  }

  /** Create an empty file. Fails rather than truncating if it already exists. */
  'fs:createFile': {
    request: { path: string }
    response: { path: string }
  }

  'fs:createDirectory': {
    request: { path: string }
    response: { path: string }
  }

  'fs:rename': {
    request: { from: string; to: string }
    response: { path: string }
  }

  /**
   * Moves to the OS trash, never unlinks. A delete you cannot undo is not a
   * feature an editor should have.
   */
  'fs:delete': {
    request: { path: string }
    response: Record<string, never>
  }

  /** Reveal in Explorer/Finder/file manager. */
  'fs:reveal': {
    request: { path: string }
    response: Record<string, never>
  }

  /**
   * Flat list of every file under the workspace, for quick-open. Walked in the
   * main process because doing it over per-directory `fs:list` calls would be
   * thousands of round trips.
   */
  'fs:walk': {
    request: Record<string, never>
    response: { files: string[]; truncated: boolean }
  }

  /**
   * Ask before destroying unsaved work. Returns which button was pressed so the
   * renderer decides what to do — main does not know what "save" means here.
   */
  'dialog:confirmDiscard': {
    request: { name: string }
    response: { action: 'save' | 'discard' | 'cancel' }
  }

  /**
   * The file changed on disk since it was opened and a save was refused.
   *
   * Without this the mtime guard is a trap rather than a safety net: it blocks
   * the write, and there is no second move. `git pull` with a file open meant
   * every subsequent save failed and the only way out was closing the tab and
   * discarding the work.
   */
  'dialog:resolveConflict': {
    request: { name: string }
    response: { action: 'overwrite' | 'reload' | 'cancel' }
  }

  /**
   * Tells main how many tabs are dirty so it can guard the window close.
   * The renderer cannot veto a window close on its own.
   */
  'app:setDirtyCount': {
    request: { count: number }
    response: Record<string, never>
  }

  /**
   * Session restore. Stored in the app's userData rather than localStorage so
   * it survives a cleared renderer profile and can be inspected by a human.
   */
  'session:load': {
    request: Record<string, never>
    response: { session: Session | null }
  }

  'session:save': {
    request: { session: Session }
    response: Record<string, never>
  }

  /**
   * Start the language server for the current workspace, if it is not already
   * running. Idempotent — the renderer calls it whenever a file the server
   * handles is opened, rather than tracking lifecycle itself.
   */
  'lsp:start': {
    request: Record<string, never>
    response: { state: LspState }
  }

  /**
   * One JSON-RPC message, renderer to server, already serialised.
   *
   * Deliberately opaque. Main frames it and writes it to the server's stdin and
   * does not otherwise care what it says: @codemirror/lsp-client owns the
   * protocol, and a main process that also parsed requests would be a second
   * implementation to keep in step with it.
   */
  'lsp:send': {
    request: { message: string }
    response: Record<string, never>
  }

  /**
   * Open a shell. Returns the id every later call uses.
   *
   * Keyed by id even though the UI opens one terminal, because adding an id to
   * a contract that is already live is exactly the retrofit this table exists
   * to prevent.
   */
  'pty:start': {
    request: { cols: number; rows: number }
    /**
     * `shell` is what to call the tab. A bare index told you a terminal existed
     * and nothing else, and it stops meaning anything at all once more than one
     * kind of shell can be started.
     */
    response: { id: string; shell: string }
  }

  /** Keystrokes, straight through. The shell decides what they mean. */
  'pty:write': {
    request: { id: string; data: string }
    response: Record<string, never>
  }

  /**
   * The terminal was resized. Without this the shell keeps wrapping lines at
   * the width it started with, and anything drawing a box gets it wrong.
   */
  'pty:resize': {
    request: { id: string; cols: number; rows: number }
    response: Record<string, never>
  }

  'pty:kill': {
    request: { id: string }
    response: Record<string, never>
  }

  /**
   * Flow control. The renderer tells main to stop reading the shell while it
   * works through what it already has.
   *
   * Without it a command that prints fast wins the race outright. xterm's write
   * buffer discards at 50 MB and throws while doing it, and its own source
   * notes it is typically unresponsive a hundred times below that. `git log -p`
   * on a real repo gets there. node-pty ships pause and resume for exactly
   * this, and nothing was calling them.
   */
  'pty:setPaused': {
    request: { id: string; paused: boolean }
    response: Record<string, never>
  }

  /**
   * The system clipboard, through main rather than through `navigator.clipboard`.
   *
   * The web API would mean depending on a secure context and on Chromium's
   * clipboard-read permission behaving the same way under a `file://` origin in
   * a packaged build as it does over http in dev. Electron's own clipboard has
   * neither question attached to it, and the renderer cannot import electron,
   * so it comes across the contract like everything else.
   */
  'clipboard:write': {
    request: { text: string }
    response: Record<string, never>
  }

  'clipboard:read': {
    request: Record<string, never>
    response: { text: string }
  }

  /**
   * Start a search over the workspace. Returns the id every later message
   * carries; answers arrive on `search:matches` and always end with
   * `search:done`.
   *
   * Nothing useful can come back through this response. Reading a few thousand
   * files takes hundreds of milliseconds, and one response means an empty panel
   * for all of it and then everything at once.
   *
   * Starting a run cancels the one before it, so a renderer that forgets to
   * cancel cannot leak one. Fails with BAD_PATTERN for a regex that will not
   * compile, so a half-typed group reads as a message rather than as no results.
   */
  'search:start': {
    request: { query: SearchQuery }
    response: { id: string }
  }

  /** Stop a run. An id that already finished is ignored, as with pty:resize. */
  'search:cancel': {
    request: { id: string }
    response: Record<string, never>
  }

  /**
   * Every buffer with unsaved edits, so a crash does not take them.
   *
   * The whole set each time, not deltas. A missed "this one is clean now" would
   * otherwise leave a stale backup that restores edits the user already saved.
   *
   * `session.ts` says file contents never go in the session, and it is right:
   * a clean file lives on disk and a copy would be a second source of truth.
   * Unsaved edits are the inverse. They exist in one place only, and that place
   * is a renderer that a power cut ends.
   */
  'buffer:sync': {
    request: { buffers: Array<{ path: string; content: string; mtimeMs: number }> }
    response: Record<string, never>
  }

  'buffer:restore': {
    request: Record<string, never>
    response: { buffers: Array<{ path: string; content: string; mtimeMs: number }> }
  }

  /**
   * Which files to watch for changes made outside the editor, and the mtime the
   * renderer believes each one currently has.
   *
   * The baseline comes from the renderer rather than being taken in main,
   * because main would otherwise have to distinguish its own writes from
   * everyone else's and every save would look like an external change.
   */
  'watch:files': {
    request: { files: Array<{ path: string; mtimeMs: number }> }
    response: Record<string, never>
  }
}

/** Where the language server is in its lifecycle. */
export type LspState = 'stopped' | 'starting' | 'running' | 'failed'

/** What is worth restoring. Deliberately not the file contents — those live on disk. */
export type Session = {
  root: string | null
  openPaths: string[]
  activePath: string | null
  /** Keyed by path, so reopening a file lands where you left it. */
  cursors: Record<string, { line: number; column: number }>
  /**
   * The split tree.
   *
   * Here rather than in localStorage, which is where it started. localStorage
   * is held in memory and flushed to disk on Chromium's own schedule, so a
   * `SIGKILL` loses it: measured, in the drive suite, as a window that came
   * back with its unsaved edits intact and its panes gone. The session file is
   * written through and survives, and a layout belongs with the tabs anyway.
   */
  layout: LayoutNode | null
}

export type IpcChannel = keyof IpcContract & string
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/**
 * Errors cross the bridge as data, never as thrown Errors.
 *
 * Electron serializes a thrown Error into a string with the main-process stack
 * glued onto the front, so the renderer cannot branch on what went wrong. An
 * explicit result envelope keeps failures structured and inspectable.
 */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string; code?: string } }

/**
 * Runtime allowlist. The preload refuses any channel not in this array, so a
 * compromised renderer cannot reach arbitrary ipcMain handlers by guessing
 * names.
 */
export const IPC_CHANNELS = [
  'app:ping',
  'workspace:open',
  'workspace:current',
  'fs:list',
  'fs:read',
  'fs:write',
  'fs:createFile',
  'fs:createDirectory',
  'fs:rename',
  'fs:delete',
  'fs:reveal',
  'fs:walk',
  'dialog:confirmDiscard',
  'dialog:resolveConflict',
  'app:setDirtyCount',
  'session:load',
  'session:save',
  'lsp:start',
  'lsp:send',
  'pty:start',
  'pty:write',
  'pty:resize',
  'pty:kill',
  'pty:setPaused',
  'clipboard:write',
  'clipboard:read',
  'search:start',
  'search:cancel',
  'buffer:sync',
  'buffer:restore',
  'watch:files'
] as const

/**
 * Main -> renderer push, kept in its own table because these are unsolicited
 * and one-way.
 *
 * Added before anything needs it. Almost everything still to come is push, not
 * request/response -- LSP publishDiagnostics, PTY output, compile and run
 * stderr, file-watch events, and eventually CRDT peer updates. Establishing the
 * shape now costs an hour; retrofitting it across three live subsystems does not.
 */
export type IpcEventContract = {
  /** The workspace root changed. null means it was closed. */
  'workspace:changed': { root: string | null }
  /** A file open in the editor changed on disk underneath us. */
  'file:changed-on-disk': { path: string; mtimeMs: number }
  /** The tree changed on disk and should reload the given directory. */
  'fs:invalidate': { path: string }
  /**
   * One JSON-RPC message, server to renderer, still serialised.
   *
   * This is the channel the push table was built for before anything needed
   * it: the server talks whenever it likes, and diagnostics in particular
   * arrive unsolicited some time after a change.
   */
  'lsp:message': { message: string }
  /** The language server changed state. `detail` explains a failure. */
  'lsp:status': { state: LspState; detail?: string }
  /** Output from a shell. Arrives whenever the shell feels like it. */
  'pty:data': { id: string; data: string }
  /** A shell exited, whether the user typed `exit` or it died. */
  /**
   * The shell ended. The pane stays: the exit code and whatever the command
   * printed before dying are usually the thing you opened the terminal to read,
   * and closing the pane on exit threw both away.
   */
  'pty:exit': { id: string; code: number }
  /**
   * A batch of search matches, and how far the run has got.
   *
   * Batched because ten thousand matches would be ten thousand structured
   * clones and ten thousand renderer wakeups to paint a list that cannot update
   * faster than the screen. Sent empty as well, so a slow run with no hits still
   * shows progress instead of looking hung.
   */
  'search:matches': { id: string; matches: SearchMatch[]; filesSearched: number }
  /**
   * A run ended. Always sent: on completion, on the match limit, on cancel and
   * on a throw. A streaming contract with no guaranteed terminal event is the one
   * shape that cannot be debugged from the UI, because a dead search and a slow
   * one look identical.
   */
  'search:done': { id: string } & SearchDone
}

export type IpcEvent = keyof IpcEventContract & string
export type IpcEventPayload<E extends IpcEvent> = IpcEventContract[E]

export const IPC_EVENTS = [
  'workspace:changed',
  'file:changed-on-disk',
  'fs:invalidate',
  'lsp:message',
  'lsp:status',
  'pty:data',
  'pty:exit',
  'search:matches',
  'search:done'
] as const

type MissingEvent = Exclude<IpcEvent, (typeof IPC_EVENTS)[number]>
type AllEventsAllowlisted = [MissingEvent] extends [never]
  ? true
  : { error: 'event declared in IpcEventContract but missing from IPC_EVENTS'; missing: MissingEvent }
const _allEventsAllowlisted: AllEventsAllowlisted = true
void _allEventsAllowlisted

export function isIpcEvent(value: unknown): value is IpcEvent {
  return typeof value === 'string' && (IPC_EVENTS as readonly string[]).includes(value)
}

/**
 * Compile-time exhaustiveness guard.
 *
 * Declaring a channel in IpcContract but forgetting to add it to IPC_CHANNELS
 * would leave it permanently blocked by the preload with no obvious cause.
 * This makes that a type error naming the missing channel instead.
 */
type MissingFromAllowlist = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>
type AllChannelsAllowlisted = [MissingFromAllowlist] extends [never]
  ? true
  : { error: 'channel declared in IpcContract but missing from IPC_CHANNELS'; missing: MissingFromAllowlist }
const _allChannelsAllowlisted: AllChannelsAllowlisted = true
void _allChannelsAllowlisted

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value)
}

/**
 * The entire surface the renderer is given. Declared here rather than inferred
 * from the preload so that main, preload and renderer all agree on one
 * definition and none of them imports across process boundaries.
 *
 * Deliberately one method. `ipcRenderer` is never exposed: handing the renderer
 * a general-purpose `send`/`invoke` would make the allowlist decorative.
 */
export type ClavenApi = {
  invoke<C extends IpcChannel>(
    channel: C,
    request: IpcRequest<C>
  ): Promise<IpcResult<IpcResponse<C>>>

  /**
   * Listen for a pushed event. Returns an unsubscribe function.
   *
   * The handler receives only the payload. Electron's IpcRendererEvent is
   * deliberately not passed through -- it carries a `sender` that would hand
   * the renderer a capability the allowlist exists to withhold.
   */
  subscribe<E extends IpcEvent>(event: E, handler: (payload: IpcEventPayload<E>) => void): () => void
}
