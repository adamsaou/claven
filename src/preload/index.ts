import { contextBridge, ipcRenderer } from 'electron'
import {
  isIpcChannel,
  type ClavenApi,
  type IpcChannel,
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
  }
}

contextBridge.exposeInMainWorld('claven', api)
