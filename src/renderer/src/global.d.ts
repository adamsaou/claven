import type { ClavenApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** Exposed by the preload via contextBridge. The renderer's entire reach into main. */
    readonly claven: ClavenApi
  }
}

export {}
