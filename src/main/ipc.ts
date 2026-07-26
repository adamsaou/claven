import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  IPC_CHANNELS,
  type IpcChannel,
  type IpcEvent,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  type IpcResult
} from '../shared/ipc'

/**
 * Push an event to every open window.
 *
 * Typed against IpcEventContract, so an event name and a payload that disagree
 * is a compile error rather than a listener that silently never fires.
 */
export function emit<E extends IpcEvent>(event: E, payload: IpcEventPayload<E>): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(event, payload)
  }
}

type Handler<C extends IpcChannel> = (
  request: IpcRequest<C>,
  event: IpcMainInvokeEvent
) => IpcResponse<C> | Promise<IpcResponse<C>>

const registered = new Set<IpcChannel>()

/**
 * Origins allowed to invoke. In dev the renderer is served over http from the
 * vite server; in production it is a file:// URL. Anything else reaching a
 * handler means something has gone wrong, and a handler that spawns language
 * servers and PTYs is not somewhere to find out late.
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  if (!url) return false
  if (url.startsWith('file://')) return true
  if (!process.env.ELECTRON_RENDERER_URL) return false
  return url.startsWith(process.env.ELECTRON_RENDERER_URL)
}

/**
 * Register a typed handler. The channel determines both the request and the
 * response type, so returning the wrong shape is a compile error rather than
 * something the renderer discovers at runtime.
 */
export function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  if (registered.has(channel)) {
    throw new Error(`ipc: handler for "${channel}" registered twice`)
  }
  registered.add(channel)

  ipcMain.handle(channel, async (event, request: unknown): Promise<IpcResult<IpcResponse<C>>> => {
    if (!isTrustedSender(event)) {
      return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'sender not trusted' } }
    }
    try {
      const value = await handler(request as IpcRequest<C>, event)
      return { ok: true, value }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const code = cause instanceof Error && 'code' in cause ? String(cause.code) : undefined
      console.error(`ipc: "${channel}" failed:`, cause)
      return { ok: false, error: { message, code } }
    }
  })
}

/**
 * Fail at startup if a declared channel has no handler.
 *
 * Without this the symptom is a renderer call that hangs forever with no error,
 * which is a genuinely annoying thing to debug.
 */
export function assertEveryChannelHandled(): void {
  const missing = IPC_CHANNELS.filter((channel) => !registered.has(channel))
  if (missing.length > 0) {
    throw new Error(`ipc: declared channels with no handler: ${missing.join(', ')}`)
  }
}
