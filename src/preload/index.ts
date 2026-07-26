import { contextBridge, ipcRenderer } from 'electron'
import {
  isIpcChannel,
  isIpcEvent,
  type ClavenApi,
  type IpcChannel,
  type IpcEvent,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  type IpcResult
} from '../shared/ipc'

/**
 * The only bridge between renderer and main.
 *
 * Runs with sandbox: true and contextIsolation: true, so the renderer has no
 * Node access at all and can reach exactly what is exposed below. The channel
 * check is the second line of defence after the main-process sender check --
 * neither is sufficient alone.
 */
const api: ClavenApi = {
  invoke<C extends IpcChannel>(
    channel: C,
    request: IpcRequest<C>
  ): Promise<IpcResult<IpcResponse<C>>> {
    if (!isIpcChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'BLOCKED_CHANNEL', message: `channel "${String(channel)}" is not in the contract` }
      })
    }
    return ipcRenderer.invoke(channel, request)
  },

  subscribe<E extends IpcEvent>(event: E, handler: (payload: IpcEventPayload<E>) => void): () => void {
    if (!isIpcEvent(event)) {
      console.error(`claven: refused to subscribe to "${String(event)}" — not in the contract`)
      return () => undefined
    }
    // The IpcRendererEvent first argument is dropped deliberately: it exposes a
    // `sender` the renderer has no business holding.
    const listener = (_event: unknown, payload: IpcEventPayload<E>): void => handler(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
}

contextBridge.exposeInMainWorld('claven', api)
