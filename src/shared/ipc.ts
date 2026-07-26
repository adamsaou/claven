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
  'fs:write'
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
}

export type IpcEvent = keyof IpcEventContract & string
export type IpcEventPayload<E extends IpcEvent> = IpcEventContract[E]

export const IPC_EVENTS = ['workspace:changed', 'file:changed-on-disk'] as const

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
