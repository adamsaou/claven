import { LSPClient, LSPPlugin, languageServerSupport, type Transport } from '@codemirror/lsp-client'
import { linter, type Diagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import type { EditorLanguage } from './CodeMirrorEditor'

/**
 * The language server seam, renderer side. Part of the adapter directory
 * deliberately: @codemirror/lsp-client wires itself into the view, so it
 * belongs behind the same boundary as everything else CodeMirror.
 *
 * Main owns the process and the wire framing. This owns the protocol. The two
 * meet over exactly two IPC channels carrying opaque strings, which is why
 * neither has to know anything about the other's job.
 */

/**
 * A path as the operating system writes it, to the URI the protocol expects.
 *
 * This function is where language server integrations traditionally go wrong on
 * Windows, so it is written out rather than improvised at the call site:
 *
 *   C:\Users\HP\claven\src\App.tsx  ->  file:///C:/Users/HP/claven/src/App.tsx
 *
 * Three separate things matter. Backslashes become forward slashes. A drive
 * letter needs the third slash, so `file://C:/...` is wrong — that reads `C:`
 * as a hostname. And each segment is encoded individually, because encoding the
 * whole path would eat the separators, while encoding nothing breaks the first
 * time a folder has a space or a non-Latin character in its name.
 */
export function pathToUri(path: string): string {
  const normalised = path.replace(/\\/g, '/')
  const withRoot = /^[a-zA-Z]:/.test(normalised) ? `/${normalised}` : normalised
  return `file://${withRoot.split('/').map(encodeURIComponent).join('/')}`
}

/** The inverse, for jumping to a location the server hands back. */
export function uriToPath(uri: string): string {
  const withoutScheme = uri.replace(/^file:\/\//, '')
  const decoded = withoutScheme.split('/').map(decodeURIComponent).join('/')
  // Strip the leading slash that a drive letter needed on the way out.
  return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded
}

/** Which languages a server is wired up for. Everything else opens plain. */
const SERVED: ReadonlySet<EditorLanguage> = new Set<EditorLanguage>(['typescript', 'tsx'])

export function hasLanguageServer(language: EditorLanguage): boolean {
  return SERVED.has(language)
}

/** The language id the protocol uses, which is not the one this app uses. */
export function languageId(language: EditorLanguage): string {
  return language === 'tsx' ? 'typescriptreact' : 'typescript'
}

/**
 * Transport over the IPC bridge. Three methods, per the interface — everything
 * hard about this lives in main.
 */
/**
 * Requests the server makes of us that we answer here rather than pass on.
 *
 * @codemirror/lsp-client handles server *notifications* but has no hook for
 * server *requests*, so anything in this list would otherwise get -32601 back
 * and TypeScript would log a failure on every startup. Declaring
 * `dynamicRegistration: false` in the client capabilities is the polite way to
 * ask it not to, and was tried first — TypeScript registers regardless.
 *
 * Answering `null` is the correct reply: it acknowledges the request, and we
 * genuinely do not act on either registration.
 */
const ANSWERED_HERE = new Set(['client/registerCapability', 'client/unregisterCapability'])

function ipcTransport(): Transport {
  const handlers = new Set<(value: string) => void>()

  const send = (message: string): void => {
    void window.claven.invoke('lsp:send', { message })
  }

  window.claven.subscribe('lsp:message', (payload) => {
    // Cheap guard first. The server emits a great many window/logMessage
    // notifications and parsing every one of them to look for two methods
    // would be a waste.
    if (payload.message.includes('"client/')) {
      try {
        const parsed: unknown = JSON.parse(payload.message)
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'id' in parsed &&
          'method' in parsed &&
          typeof parsed.method === 'string' &&
          ANSWERED_HERE.has(parsed.method)
        ) {
          send(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }))
          return
        }
      } catch {
        // Not our business. Fall through and let the client deal with it.
      }
    }
    // Copied before iterating: a handler that unsubscribes itself while the
    // set is being walked would otherwise skip the next one.
    for (const handler of [...handlers]) handler(payload.message)
  })

  return {
    send,
    subscribe(handler) {
      handlers.add(handler)
    },
    unsubscribe(handler) {
      handlers.delete(handler)
    }
  }
}

let client: LSPClient | null = null

/**
 * The one client, created on first use.
 *
 * A single client for the workspace rather than one per file: the server is
 * per project, and opening a second connection for the second tab would spawn
 * a second copy of the TypeScript program — the expensive part.
 */
export function languageClient(rootPath: string): LSPClient {
  if (client === null) {
    client = new LSPClient({
      rootUri: pathToUri(rootPath),
      /**
       * Say out loud that dynamic registration is not supported.
       *
       * @codemirror/lsp-client answers notifications but has no hook for
       * server-to-client *requests*, so `client/registerCapability` gets
       * -32601 back and TypeScript logs a failure on every single startup.
       * Under LSP an absent capability already means "not supported", but
       * stating it is the protocol's own way to stop a server asking — and a
       * permanent error in the log is how you learn to stop reading logs.
       */
      extensions: [
        {
          clientCapabilities: {
            workspace: {
              didChangeConfiguration: { dynamicRegistration: false },
              didChangeWatchedFiles: { dynamicRegistration: false }
            }
          }
        }
      ]
    }).connect(ipcTransport())
  }
  return client
}

/** Tear down on workspace change, so the next root gets a fresh client. */
export function disconnectLanguageClient(): void {
  client?.disconnect()
  client = null
}

/** LSP severity is 1..4 and ordered the opposite way round to how it reads. */
const SEVERITY: Record<number, Diagnostic['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint'
}

/** One item of a `textDocument/diagnostic` report. */
type ServerDiagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
  source?: string
  code?: string | number
}

type DiagnosticReport = { kind: 'full'; items: ServerDiagnostic[] } | { kind: 'unchanged' }

/**
 * Diagnostics, pulled.
 *
 * `languageServerSupport` listens for `textDocument/publishDiagnostics`, which
 * the server pushes. TypeScript 7 does not really push: it advertises a
 * `diagnosticProvider` and expects to be *asked*, via `textDocument/diagnostic`
 * (the LSP 3.17 model). Measured against the real server, the push fired once
 * with an empty list while the pull returned the actual error — so without this
 * the editor would look connected and never squiggle anything.
 *
 * Written as a `linter` source because @codemirror/lint already solves the
 * parts that are tedious rather than interesting: debouncing, re-running on
 * change, and rendering the underline and the hover panel.
 */
function pulledDiagnostics(): Extension {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const plugin = LSPPlugin.get(view)
      if (plugin === null) return []

      // Flush pending edits first. Without this the server answers about the
      // document as it was a few keystrokes ago, and the ranges land in the
      // wrong place — which looks like an off-by-one in the editor rather than
      // what it is.
      plugin.client.sync()

      let report: DiagnosticReport
      try {
        report = await plugin.client.request<{ textDocument: { uri: string } }, DiagnosticReport>(
          'textDocument/diagnostic',
          { textDocument: { uri: plugin.uri } }
        )
      } catch {
        // A server that is still starting, or has just died. Reporting nothing
        // is right: stale squiggles are worse than none.
        return []
      }
      if (report.kind !== 'full') return []

      const doc = view.state.doc
      return report.items.map((item) => {
        const from = plugin.fromPosition(item.range.start, doc)
        const to = plugin.fromPosition(item.range.end, doc)
        return {
          // Clamped, and `to` is never behind `from`: a zero-width range at
          // the end of the document is legal in LSP and throws in CodeMirror.
          from: Math.min(Math.max(from, 0), doc.length),
          to: Math.min(Math.max(to, from), doc.length),
          severity: SEVERITY[item.severity ?? 1] ?? 'error',
          message: item.message,
          source: item.code === undefined ? item.source : `${item.source ?? 'ts'} ${item.code}`
        }
      })
    },
    // Long enough not to re-ask on every keystroke, short enough that an error
    // appears while you are still looking at the line that caused it.
    { delay: 400 }
  )
}

/**
 * The editor extension for one file. Named to stay clearly distinct from the
 * package's own `languageServerExtensions`, which is a different thing.
 *
 * `languageServerSupport` brings completion, hover, go-to-definition and
 * rename with it. Diagnostics are the one part it cannot do here, for the
 * reason above.
 */
export function lspExtensionFor(
  rootPath: string,
  path: string,
  language: EditorLanguage
): Extension[] {
  if (!hasLanguageServer(language)) return []
  return [
    languageServerSupport(languageClient(rootPath), pathToUri(path), languageId(language)),
    pulledDiagnostics()
  ]
}
