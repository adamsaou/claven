import { useCallback, useEffect, useState } from 'react'
import { FileTree } from './FileTree'
import { CodeMirrorEditor, languageForPath } from './editor/CodeMirrorEditor'
import type { FileMeta } from '../../shared/files'

type Tab = {
  path: string
  name: string
  content: string
  /** What is on disk. Dirty is content !== saved, so no manual flag to forget to clear. */
  saved: string
  meta: FileMeta
}

type Notice = { kind: 'info' | 'error'; text: string } | null

export default function App(): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const active = tabs.find((tab) => tab.path === activePath) ?? null

  useEffect(() => {
    void window.claven.invoke('workspace:current', {}).then((result) => {
      if (result.ok) setRoot(result.value.root)
    })
    // Proves the push channel end to end: the root also arrives unsolicited.
    return window.claven.subscribe('workspace:changed', (payload) => setRoot(payload.root))
  }, [])

  const openFolder = useCallback(async () => {
    const result = await window.claven.invoke('workspace:open', {})
    if (!result.ok) setNotice({ kind: 'error', text: result.error.message })
  }, [])

  const openFile = useCallback(
    async (path: string) => {
      if (tabs.some((tab) => tab.path === path)) {
        setActivePath(path)
        return
      }
      const result = await window.claven.invoke('fs:read', { path })
      if (!result.ok) {
        setNotice({ kind: 'error', text: result.error.message })
        return
      }
      const value = result.value
      if (value.kind === 'binary') {
        setNotice({ kind: 'info', text: `${path.split(/[\\/]/).pop()} is a binary file` })
        return
      }
      if (value.kind === 'too-large') {
        setNotice({
          kind: 'info',
          text: `too large: ${(value.size / 1024 / 1024).toFixed(1)} MB (limit ${value.limit / 1024 / 1024} MB)`
        })
        return
      }
      setTabs((current) => [
        ...current,
        {
          path,
          name: path.split(/[\\/]/).pop() ?? path,
          content: value.content,
          saved: value.content,
          meta: value.meta
        }
      ])
      setActivePath(path)
      setNotice(
        value.meta.mixedLineEndings
          ? { kind: 'info', text: 'mixed line endings — saving will normalise to ' + value.meta.lineEnding }
          : null
      )
    },
    [tabs]
  )

  const save = useCallback(async () => {
    if (!active || active.content === active.saved) return
    const result = await window.claven.invoke('fs:write', {
      path: active.path,
      content: active.content,
      meta: active.meta,
      expectedMtimeMs: active.meta.mtimeMs
    })
    if (!result.ok) {
      setNotice({ kind: 'error', text: result.error.message })
      return
    }
    const meta = result.value.meta
    setTabs((current) =>
      current.map((tab) => (tab.path === active.path ? { ...tab, saved: tab.content, meta } : tab))
    )
    setNotice(null)
  }, [active])

  const closeTab = useCallback(
    (path: string) => {
      setTabs((current) => {
        const next = current.filter((tab) => tab.path !== path)
        if (path === activePath) setActivePath(next.at(-1)?.path ?? null)
        return next
      })
    },
    [activePath]
  )

  return (
    <div className="flex h-full">
      <FileTree root={root} activePath={activePath} onOpenFile={(p) => void openFile(p)} onOpenFolder={() => void openFolder()} />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-edge flex h-9 shrink-0 items-stretch overflow-x-auto border-b">
          {tabs.map((tab) => {
            const dirty = tab.content !== tab.saved
            return (
              <div
                key={tab.path}
                className={`border-edge flex shrink-0 items-center gap-2 border-e px-3 text-[13px] ${
                  tab.path === activePath ? 'bg-surface text-ink' : 'text-ink-dim hover:bg-white/5'
                }`}
              >
                <button onClick={() => setActivePath(tab.path)} dir="auto" className="max-w-48 truncate">
                  {tab.name}
                </button>
                <button
                  onClick={() => closeTab(tab.path)}
                  title={dirty ? 'unsaved changes' : 'close'}
                  className="shrink-0 opacity-60 hover:opacity-100"
                >
                  {dirty ? '●' : '×'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="min-h-0 flex-1">
          {active ? (
            <CodeMirrorEditor
              key={active.path}
              value={active.content}
              language={languageForPath(active.path)}
              onChange={(content) =>
                setTabs((current) =>
                  current.map((tab) => (tab.path === active.path ? { ...tab, content } : tab))
                )
              }
              onSave={() => void save()}
            />
          ) : (
            <div className="text-ink-dim flex h-full items-center justify-center text-sm">
              {root === null ? 'open a folder to start' : 'select a file'}
            </div>
          )}
        </div>

        <footer className="border-edge text-ink-dim flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs">
          {active && (
            <>
              <span>{active.meta.lineEnding.toUpperCase()}</span>
              <span>{active.meta.encoding}</span>
              {active.content !== active.saved && <span className="text-good">unsaved — Ctrl+S</span>}
            </>
          )}
          {notice && <span className={notice.kind === 'error' ? 'text-bad' : ''}>{notice.text}</span>}
        </footer>
      </main>
    </div>
  )
}
