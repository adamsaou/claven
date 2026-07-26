import { useCallback, useEffect, useState } from 'react'
import type { IpcResponse } from '../../shared/ipc'

type PingState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ok'; roundTripMs: number; value: IpcResponse<'app:ping'> }
  | { status: 'failed'; message: string; code?: string }

/**
 * M1 step one: prove the typed IPC contract end to end before anything is built
 * on top of it.
 *
 * Two things have to hold. A declared channel must complete a full round trip
 * with types intact, and an undeclared channel must be refused by the preload
 * without ever reaching main. The second is the half that is easy to assume and
 * expensive to be wrong about, so it is checked rather than trusted.
 */
export default function App(): React.JSX.Element {
  const [ping, setPing] = useState<PingState>({ status: 'idle' })
  const [blocked, setBlocked] = useState<string | null>(null)

  const runPing = useCallback(async () => {
    setPing({ status: 'pending' })
    const sentAt = Date.now()
    const result = await window.claven.invoke('app:ping', { sentAt })
    if (result.ok) {
      setPing({ status: 'ok', roundTripMs: Date.now() - sentAt, value: result.value })
    } else {
      setPing({ status: 'failed', message: result.error.message, code: result.error.code })
    }
  }, [])

  const runBlockedChannel = useCallback(async () => {
    // Deliberately off-contract. TypeScript rejects this at compile time, which
    // is the point -- the cast proves the *runtime* allowlist also holds, since
    // a compromised renderer would not be going through tsc.
    const invoke = window.claven.invoke as unknown as (
      channel: string,
      request: unknown
    ) => Promise<{ ok: boolean; error?: { message: string } }>
    const result = await invoke('fs:readFile', { path: 'C:/Windows/System32/config/SAM' })
    setBlocked(result.ok ? 'NOT BLOCKED — the allowlist is broken' : (result.error?.message ?? 'blocked'))
  }, [])

  useEffect(() => {
    void runPing()
  }, [runPing])

  return (
    <main className="flex h-full flex-col items-start gap-6 p-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Claven</h1>
        <p className="text-ink-dim mt-1 text-sm">M1 · typed IPC contract</p>
      </header>

      <section className="border-edge bg-surface-raised w-full max-w-2xl rounded-lg border p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">app:ping</h2>
          <button
            onClick={() => void runPing()}
            className="border-edge hover:bg-edge rounded border px-3 py-1 text-xs transition-colors"
          >
            send again
          </button>
        </div>

        <div className="mt-4 text-sm">
          {ping.status === 'idle' && <p className="text-ink-dim">not sent</p>}
          {ping.status === 'pending' && <p className="text-ink-dim">waiting…</p>}
          {ping.status === 'failed' && (
            <p className="text-bad">
              failed{ping.code ? ` [${ping.code}]` : ''}: {ping.message}
            </p>
          )}
          {ping.status === 'ok' && (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5">
              <dt className="text-ink-dim">round trip</dt>
              <dd className="text-good">{ping.roundTripMs} ms</dd>
              <dt className="text-ink-dim">main pid</dt>
              <dd>{ping.value.pid}</dd>
              <dt className="text-ink-dim">electron</dt>
              <dd>{ping.value.versions.electron}</dd>
              <dt className="text-ink-dim">chromium</dt>
              <dd>{ping.value.versions.chrome}</dd>
              <dt className="text-ink-dim">node (main)</dt>
              <dd>{ping.value.versions.node}</dd>
              <dt className="text-ink-dim">v8</dt>
              <dd>{ping.value.versions.v8}</dd>
            </dl>
          )}
        </div>
      </section>

      <section className="border-edge bg-surface-raised w-full max-w-2xl rounded-lg border p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">off-contract channel</h2>
          <button
            onClick={() => void runBlockedChannel()}
            className="border-edge hover:bg-edge rounded border px-3 py-1 text-xs transition-colors"
          >
            try fs:readFile
          </button>
        </div>
        <p className="text-ink-dim mt-3 text-sm">
          {blocked === null ? 'not tested' : blocked}
        </p>
      </section>

      <footer className="text-ink-dim text-xs">
        renderer: sandboxed, no node integration, context isolated
      </footer>
    </main>
  )
}
