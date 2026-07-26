import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './TitleBar'
import { FileTree } from './FileTree'
import { CommandPalette, type Command } from './CommandPalette'
import { CodeMirrorEditor, languageForPath, type CursorPosition } from './editor/CodeMirrorEditor'
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

/** Voice, per BRAND.md: terse, mechanical, lowercase in-product. */
const LANGUAGE_LABEL: Record<string, string> = {
  typescript: 'typescript',
  tsx: 'tsx',
  cpp: 'c++',
  java: 'java',
  python: 'python',
  json: 'json',
  markdown: 'markdown',
  html: 'html',
  css: 'css',
  rust: 'rust',
  plain: 'text'
}

export default function App(): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1, selected: 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const activeTabRef = useRef<HTMLDivElement>(null)

  const active = tabs.find((tab) => tab.path === activePath) ?? null
  const dirty = active !== null && active.content !== active.saved

  useEffect(() => {
    void window.claven.invoke('workspace:current', {}).then((result) => {
      if (result.ok) setRoot(result.value.root)
    })
    // Proves the push channel end to end: the root also arrives unsolicited.
    return window.claven.subscribe('workspace:changed', (payload) => setRoot(payload.root))
  }, [])

  // The window title is the fastest way to know which file is focused when
  // Claven is one of eight things in the taskbar.
  useEffect(() => {
    document.title = active ? `${dirty ? '● ' : ''}${active.name} — Claven` : 'Claven'
  }, [active, dirty])

  // Switching to a tab that is scrolled off-screen should bring it into view.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activePath])

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
      const name = path.split(/[\\/]/).pop() ?? path
      if (value.kind === 'binary') {
        setNotice({ kind: 'info', text: `${name} is binary` })
        return
      }
      if (value.kind === 'too-large') {
        setNotice({
          kind: 'info',
          text: `${name} is ${(value.size / 1024 / 1024).toFixed(1)} mb, over the ${value.limit / 1024 / 1024} mb limit`
        })
        return
      }
      setTabs((current) => [
        ...current,
        { path, name, content: value.content, saved: value.content, meta: value.meta }
      ])
      setActivePath(path)
      setNotice(
        value.meta.mixedLineEndings
          ? { kind: 'info', text: `mixed line endings — saving normalises to ${value.meta.lineEnding}` }
          : null
      )
    },
    [tabs]
  )

  const save = useCallback(async () => {
    if (!active || active.content === active.saved) return
    const started = performance.now()
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
    // "Opened 2.1 GB in 0.8s." — state what happened and how long it took.
    setNotice({ kind: 'info', text: `saved in ${Math.round(performance.now() - started)}ms` })
  }, [active])

  const closeTab = useCallback((path: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.path === path)
      const next = current.filter((tab) => tab.path !== path)
      setActivePath((currentActive) => {
        if (currentActive !== path) return currentActive
        // Focus the neighbour rather than jumping to the end of the strip.
        return next[Math.min(index, next.length - 1)]?.path ?? null
      })
      return next
    })
  }, [])

  const cycleTab = useCallback(
    (delta: number) => {
      setActivePath((current) => {
        if (tabs.length === 0) return null
        const index = tabs.findIndex((tab) => tab.path === current)
        const next = (index + delta + tabs.length) % tabs.length
        return tabs[next]?.path ?? current
      })
    },
    [tabs]
  )

  // Titles are lowercase and verb-first, per the BRAND.md voice.
  const commands = useMemo<Command[]>(
    () => [
      { id: 'workspace.open', title: 'open folder', keys: 'ctrl+k o', run: () => void openFolder() },
      { id: 'file.save', title: 'save file', keys: 'ctrl+s', enabled: dirty, run: () => void save() },
      {
        id: 'view.toggleSidebar',
        title: 'toggle sidebar',
        keys: 'ctrl+b',
        run: () => setSidebarVisible((visible) => !visible)
      },
      {
        id: 'tab.close',
        title: 'close tab',
        keys: 'ctrl+w',
        enabled: active !== null,
        run: () => active && closeTab(active.path)
      },
      {
        id: 'tab.closeAll',
        title: 'close all tabs',
        enabled: tabs.length > 0,
        run: () => {
          setTabs([])
          setActivePath(null)
        }
      },
      { id: 'tab.next', title: 'next tab', keys: 'ctrl+tab', enabled: tabs.length > 1, run: () => cycleTab(1) },
      {
        id: 'tab.previous',
        title: 'previous tab',
        keys: 'ctrl+shift+tab',
        enabled: tabs.length > 1,
        run: () => cycleTab(-1)
      }
    ],
    [openFolder, save, dirty, active, closeTab, tabs.length, cycleTab]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return

      // ctrl+shift+p matches every editor's muscle memory. Fighting that is a
      // cost with no upside.
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setSidebarVisible((visible) => !visible)
      } else if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (active) closeTab(active.path)
      } else if (event.key === 'Tab') {
        event.preventDefault()
        cycleTab(event.shiftKey ? -1 : 1)
      }
      // ctrl+s is bound inside CodeMirror's keymap so it works while typing;
      // duplicating it here would fire the save twice.
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, closeTab, cycleTab])

  return (
    <div className="relative flex h-full flex-col">
      <TitleBar root={root} />

      <div className="flex min-h-0 flex-1">
        {sidebarVisible && (
          <FileTree
            root={root}
            activePath={activePath}
            onOpenFile={(path) => void openFile(path)}
            onOpenFolder={() => void openFolder()}
          />
        )}

        <main className="bg-obsidian flex min-w-0 flex-1 flex-col">
        <div
          className="border-line bg-surface-1 flex shrink-0 items-stretch overflow-x-auto border-b"
          style={{ height: 'var(--titlebar-h)' }}
        >
          {tabs.map((tab) => {
            const isActive = tab.path === activePath
            const isDirty = tab.content !== tab.saved
            return (
              <div
                key={tab.path}
                ref={isActive ? activeTabRef : undefined}
                className={`group border-line relative flex shrink-0 items-center gap-2 border-e ps-3 pe-2 transition-colors ${
                  isActive ? 'bg-obsidian text-ink' : 'text-ink-muted hover:bg-surface-2'
                }`}
                style={{ transitionDuration: 'var(--dur-micro)' }}
              >
                {/* Ember as the active-file indicator, per BRAND.md — one of the
                    few places the accent is spent. 2px, no glow. */}
                {isActive && <span className="bg-ember absolute inset-x-0 top-0 h-0.5" />}
                <button
                  onClick={() => setActivePath(tab.path)}
                  dir="auto"
                  title={tab.path}
                  className="max-w-48 truncate text-[13px]"
                >
                  {tab.name}
                </button>
                <button
                  onClick={() => closeTab(tab.path)}
                  aria-label={`close ${tab.name}`}
                  className="text-ink-dim hover:text-ink flex h-4 w-4 shrink-0 items-center justify-center text-xs"
                >
                  {/* The dot marks unsaved and becomes a close affordance on
                      hover, so one slot carries both without a second control. */}
                  <span className={isDirty ? 'group-hover:hidden' : 'hidden'}>●</span>
                  <span className={isDirty ? 'hidden group-hover:inline' : 'inline'}>×</span>
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
              onCursor={setCursor}
            />
          ) : (
            <div className="text-ink-dim flex h-full flex-col items-center justify-center gap-1 text-[13px]">
              <span>{root === null ? 'no folder open' : 'no file open'}</span>
              <span className="text-ink-dim/70 text-xs">
                {root === null ? 'open a folder to start' : 'pick a file from the tree'}
              </span>
            </div>
          )}
        </div>

        <footer
          className="border-line bg-surface-1 text-ink-muted flex shrink-0 items-center gap-4 border-t px-3 text-xs"
          style={{ height: 'var(--statusbar-h)' }}
        >
          {active && (
            <>
              <span className="tabular-nums">
                ln {cursor.line}, col {cursor.column}
                {cursor.selected > 0 && ` (${cursor.selected} selected)`}
              </span>
              <span>{LANGUAGE_LABEL[languageForPath(active.path)]}</span>
              <span>{active.meta.encoding}</span>
              <span className="uppercase">{active.meta.lineEnding}</span>
              {dirty && <span className="text-ember">unsaved</span>}
            </>
          )}
          <span className="ms-auto truncate ps-4">
            {notice && (
              <span className={notice.kind === 'error' ? 'text-error' : ''}>{notice.text}</span>
            )}
            </span>
          </footer>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  )
}
