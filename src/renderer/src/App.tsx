import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './TitleBar'
import { FileTree } from './FileTree'
import { CommandPalette, type Command } from './CommandPalette'
import { QuickOpen } from './QuickOpen'
import { Prompt, type PromptRequest } from './Prompt'
import { ContextMenu, type MenuItem, type MenuRequest } from './ContextMenu'
import { ActivityBar, type Container } from './ActivityBar'
import { Icon, iconForPath } from './Icons'
import type { DirEntry, LineEnding } from '../../shared/files'
import type { IpcResult, LspState } from '../../shared/ipc'
import { hasLanguageServer } from './editor/lsp'
import { TerminalPanel } from './terminal/TerminalPanel'
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

/**
 * True for a path and for anything inside it. Both separators are checked
 * because a path can reach here from the tree (platform separator) or from a
 * relative join (forward slash).
 */
function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)
}

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
  const [quickOpen, setQuickOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [menu, setMenu] = useState<MenuRequest | null>(null)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [pendingChord, setPendingChord] = useState<string | null>(null)
  /**
   * Mounted from the first time it is opened and never unmounted, so toggling
   * it away does not kill the shell you were halfway through using.
   */
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalStarted, setTerminalStarted] = useState(false)
  const activeTabRef = useRef<HTMLDivElement>(null)

  // Only the explorer exists, so ActivityBar renders null. It appears by itself
  // when a second container registers — diagnostics at M3 is the expected one.
  const containers: Container[] = [{ id: 'explorer', label: 'explorer', icon: 'explorer' }]

  const active = tabs.find((tab) => tab.path === activePath) ?? null
  const dirty = active !== null && active.content !== active.saved
  const openDocIds = useMemo(() => tabs.map((tab) => tab.path), [tabs])

  const [cursors, setCursors] = useState<Record<string, { line: number; column: number }>>({})
  const [restored, setRestored] = useState(false)
  const [lspState, setLspState] = useState<LspState>('stopped')

  useEffect(() => window.claven.subscribe('lsp:status', (payload) => {
    setLspState(payload.state)
    if (payload.state === 'failed' && payload.detail !== undefined) {
      setNotice({ kind: 'error', text: `language server: ${payload.detail}` })
    }
  }), [])

  /**
   * Start the server the first time a file it serves is opened, rather than on
   * launch. Starting it eagerly means every session pays for a TypeScript
   * program, including the ones spent editing a markdown file.
   *
   * The handler is idempotent, so this does not need to track whether it has
   * already run.
   */
  useEffect(() => {
    if (root === null || active === null) return
    if (!hasLanguageServer(languageForPath(active.path))) return
    void window.claven.invoke('lsp:start', {})
  }, [root, active])

  useEffect(() => {
    // Proves the push channel end to end: the root also arrives unsolicited.
    return window.claven.subscribe('workspace:changed', (payload) => setRoot(payload.root))
  }, [])

  /**
   * Restore the last session. Every restart used to be a blank slate, which
   * meant reopening the same five files by hand each time.
   */
  useEffect(() => {
    void (async () => {
      const loaded = await window.claven.invoke('session:load', {})
      if (!loaded.ok || loaded.value.session === null) {
        setRestored(true)
        return
      }
      const session = loaded.value.session
      setRoot(session.root)
      setCursors(session.cursors)

      // Read them in parallel; a file that has since been deleted or renamed
      // is skipped rather than treated as an error.
      const opened = await Promise.all(
        session.openPaths.map(async (path) => {
          const result = await window.claven.invoke('fs:read', { path })
          if (!result.ok || result.value.kind !== 'text') return null
          return {
            path,
            name: path.split(/[\\/]/).pop() ?? path,
            content: result.value.content,
            saved: result.value.content,
            meta: result.value.meta
          }
        })
      )
      const usable = opened.filter((tab): tab is Tab => tab !== null)
      setTabs(usable)
      setActivePath(
        usable.some((tab) => tab.path === session.activePath)
          ? session.activePath
          : (usable.at(-1)?.path ?? null)
      )
      setRestored(true)
    })()
  }, [])

  /**
   * Persist after the restore has run, never before — writing during startup
   * would save an empty tab list over the session we are about to read.
   */
  useEffect(() => {
    if (!restored) return
    const timer = setTimeout(() => {
      void window.claven.invoke('session:save', {
        session: {
          root,
          openPaths: tabs.map((tab) => tab.path),
          activePath,
          cursors
        }
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [restored, root, tabs, activePath, cursors])

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
      /**
       * Key the tab on the path main resolved, never on the one the caller
       * typed. The tree builds paths with the platform separator and quick-open
       * joins with a forward slash, so the same file arrived under two different
       * strings and opened twice — two tabs, two edit buffers, and whichever
       * saved second failed the changed-on-disk check.
       */
      const canonical = value.meta.path
      const existing = tabs.find((tab) => tab.path === canonical)
      if (existing !== undefined) {
        setActivePath(canonical)
        return
      }
      setTabs((current) => [
        ...current,
        {
          path: canonical,
          name: canonical.split(/[\\/]/).pop() ?? name,
          content: value.content,
          saved: value.content,
          meta: value.meta
        }
      ])
      setActivePath(canonical)
      setNotice(
        value.meta.mixedLineEndings
          ? { kind: 'info', text: `mixed line endings — saving normalises to ${value.meta.lineEnding}` }
          : null
      )
    },
    [tabs]
  )

  /** Throw away the buffer and take what is on disk. Only ever called with consent. */
  const reloadFromDisk = useCallback(async (path: string) => {
    const result = await window.claven.invoke('fs:read', { path })
    if (!result.ok || result.value.kind !== 'text') {
      setNotice({ kind: 'error', text: `could not reload ${path}` })
      return
    }
    const { content, meta } = result.value
    setTabs((current) =>
      current.map((tab) => (tab.path === path ? { ...tab, content, saved: content, meta } : tab))
    )
    setNotice({ kind: 'info', text: 'reloaded from disk' })
  }, [])

  const save = useCallback(async () => {
    if (!active || active.content === active.saved) return
    const started = performance.now()
    const write = (expectedMtimeMs: number | null): Promise<IpcResult<{ meta: FileMeta }>> =>
      window.claven.invoke('fs:write', {
        path: active.path,
        content: active.content,
        meta: active.meta,
        expectedMtimeMs
      })

    let result = await write(active.meta.mtimeMs)

    /**
     * The mtime guard refused. Offer a way out rather than leaving the tab
     * permanently unsaveable — that is what it used to do, and the only escape
     * was closing the tab and losing the edits.
     */
    if (!result.ok && result.error.code === 'CHANGED_ON_DISK') {
      const answer = await window.claven.invoke('dialog:resolveConflict', { name: active.name })
      if (!answer.ok || answer.value.action === 'cancel') {
        setNotice({ kind: 'error', text: result.error.message })
        return
      }
      if (answer.value.action === 'reload') {
        await reloadFromDisk(active.path)
        return
      }
      result = await write(null)
    }

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
  }, [active, reloadFromDisk])

  const forceCloseTabs = useCallback((matches: (path: string) => boolean) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => matches(tab.path))
      const next = current.filter((tab) => !matches(tab.path))
      setActivePath((currentActive) => {
        if (currentActive === null || !matches(currentActive)) return currentActive
        // Focus the neighbour rather than jumping to the end of the strip.
        return next[Math.min(index, next.length - 1)]?.path ?? null
      })
      return next
    })
  }, [])

  const forceCloseTab = useCallback(
    (path: string) => forceCloseTabs((candidate) => candidate === path),
    [forceCloseTabs]
  )

  /**
   * A file was renamed or moved. The tab follows it rather than being closed —
   * closing it threw away unsaved edits, which is a rename doing the job of a
   * discard. Directories carry their open children along.
   */
  const remapTabs = useCallback((from: string, to: string) => {
    const moved = (path: string): string | null =>
      isUnder(path, from) ? to + path.slice(from.length) : null
    setTabs((current) =>
      current.map((tab) => {
        const next = moved(tab.path)
        if (next === null) return tab
        return {
          ...tab,
          path: next,
          name: next.split(/[\\/]/).pop() ?? next,
          meta: { ...tab.meta, path: next }
        }
      })
    )
    setActivePath((current) => (current === null ? null : (moved(current) ?? current)))
    setCursors((current) =>
      Object.fromEntries(
        Object.entries(current).map(([path, at]) => [moved(path) ?? path, at])
      )
    )
  }, [])

  /**
   * Closing a modified tab used to discard the changes silently. That was a
   * data-loss bug, not a missing feature.
   */
  const closeTab = useCallback(
    async (path: string) => {
      const tab = tabs.find((candidate) => candidate.path === path)
      if (tab === undefined) return
      if (tab.content === tab.saved) {
        forceCloseTab(path)
        return
      }
      const answer = await window.claven.invoke('dialog:confirmDiscard', { name: tab.name })
      if (!answer.ok || answer.value.action === 'cancel') return
      if (answer.value.action === 'save') {
        const written = await window.claven.invoke('fs:write', {
          path: tab.path,
          content: tab.content,
          meta: tab.meta,
          expectedMtimeMs: tab.meta.mtimeMs
        })
        // A failed save must not close the tab — that would lose the work the
        // dialog just promised to keep.
        if (!written.ok) {
          setNotice({ kind: 'error', text: written.error.message })
          return
        }
      }
      forceCloseTab(path)
    },
    [tabs, forceCloseTab]
  )

  // Main cannot see React state, and a renderer cannot veto its own window
  // closing — so the count has to be pushed for the close guard to work.
  //
  // Derived first and pushed on the count, not on `tabs`: the tab array changes
  // identity on every keystroke, and pushing on that meant an IPC round trip
  // per character typed.
  const dirtyCount = tabs.filter((tab) => tab.content !== tab.saved).length
  useEffect(() => {
    void window.claven.invoke('app:setDirtyCount', { count: dirtyCount })
  }, [dirtyCount])

  const openRelative = useCallback(
    (relativePath: string) => {
      if (root === null) return
      void openFile(`${root}/${relativePath}`)
    },
    [root, openFile]
  )

  const fileOperations = useCallback(
    (entry: DirEntry | null): MenuItem[] => {
      if (root === null) return []
      // A file's siblings live in its parent; a directory's children live in it.
      const parent =
        entry === null
          ? root
          : entry.kind === 'directory'
            ? entry.path
            : entry.path.slice(0, Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\')))

      const run = async (
        channel: 'fs:createFile' | 'fs:createDirectory',
        name: string
      ): Promise<void> => {
        const result = await window.claven.invoke(channel, { path: `${parent}/${name}` })
        if (!result.ok) setNotice({ kind: 'error', text: result.error.message })
        else if (channel === 'fs:createFile') void openFile(result.value.path)
      }

      const items: MenuItem[] = [
        {
          kind: 'item',
          label: 'new file',
          run: () =>
            setPrompt({
              title: 'new file',
              initial: '',
              confirmLabel: 'create',
              onConfirm: (name) => void run('fs:createFile', name)
            })
        },
        {
          kind: 'item',
          label: 'new folder',
          run: () =>
            setPrompt({
              title: 'new folder',
              initial: '',
              confirmLabel: 'create',
              onConfirm: (name) => void run('fs:createDirectory', name)
            })
        }
      ]

      if (entry !== null) {
        const dot = entry.name.lastIndexOf('.')
        items.push(
          { kind: 'separator' },
          {
            kind: 'item',
            label: 'rename',
            run: () =>
              setPrompt({
                title: `rename ${entry.name}`,
                initial: entry.name,
                // Preselect the stem so typing replaces the name, not the
                // extension — renaming rarely means changing the type.
                selectTo: dot > 0 ? dot : entry.name.length,
                confirmLabel: 'rename',
                onConfirm: (name) => {
                  const to = `${parent}/${name}`
                  void window.claven
                    .invoke('fs:rename', { from: entry.path, to })
                    .then((result) => {
                      if (!result.ok) setNotice({ kind: 'error', text: result.error.message })
                      else remapTabs(entry.path, result.value.path)
                    })
                }
              })
          },
          {
            kind: 'item',
            label: 'delete',
            danger: true,
            run: () =>
              void window.claven.invoke('fs:delete', { path: entry.path }).then((result) => {
                if (!result.ok) setNotice({ kind: 'error', text: result.error.message })
                else {
                  // Everything inside a deleted folder, not just the folder —
                  // its open files were left pointing at paths that no longer
                  // exist, and only said so when you tried to save one.
                  forceCloseTabs((path) => isUnder(path, entry.path))
                  setNotice({ kind: 'info', text: `moved ${entry.name} to trash` })
                }
              })
          },
          { kind: 'separator' },
          {
            kind: 'item',
            label: 'reveal in file explorer',
            run: () => void window.claven.invoke('fs:reveal', { path: entry.path })
          }
        )
      }
      return items
    },
    [root, openFile, forceCloseTabs, remapTabs]
  )

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
      // ctrl+k ctrl+o is VS Code's real binding, and the chord is implemented
      // in the keydown handler below. It previously advertised 'ctrl+k o' with
      // no chord support at all — a shortcut that did nothing, which is worse
      // than showing none.
      { id: 'workspace.open', title: 'open folder', keys: 'ctrl+k ctrl+o', run: () => void openFolder() },
      { id: 'file.save', title: 'save file', keys: 'ctrl+s', enabled: dirty, run: () => void save() },
      {
        id: 'view.toggleTerminal',
        title: 'toggle terminal',
        keys: 'ctrl+`',
        run: () => {
          setTerminalStarted(true)
          setTerminalOpen((open) => !open)
        }
      },
      {
        id: 'view.toggleSidebar',
        title: 'toggle sidebar',
        keys: 'ctrl+b',
        run: () => setSidebarVisible((visible) => !visible)
      },
      {
        id: 'file.quickOpen',
        title: 'go to file',
        keys: 'ctrl+p',
        enabled: root !== null,
        run: () => setQuickOpen(true)
      },
      {
        id: 'tab.close',
        title: 'close tab',
        keys: 'ctrl+w',
        enabled: active !== null,
        run: () => active && void closeTab(active.path)
      },
      {
        id: 'tab.closeAll',
        title: 'close all tabs',
        enabled: tabs.length > 0,
        // Sequential on purpose: each dirty tab gets its own prompt rather
        // than one dialog standing in for all of them.
        run: () => void tabs.reduce<Promise<void>>(
          (chain, tab) => chain.then(() => closeTab(tab.path)),
          Promise.resolve()
        )
      },
      { id: 'tab.next', title: 'next tab', keys: 'ctrl+tab', enabled: tabs.length > 1, run: () => cycleTab(1) },
      // Ranked deliberately high: Windows dev, Linux judges. This is the switch
      // most likely to be needed and least likely to be remembered — exactly
      // what a palette is for.
      ...(['lf', 'crlf', 'cr'] as LineEnding[]).map((ending) => ({
        id: `file.lineEnding.${ending}`,
        title: `change line endings to ${ending}`,
        enabled: active !== null && active.meta.lineEnding !== ending,
        run: (): void =>
          setTabs((current) =>
            current.map((tab) =>
              tab.path === active?.path
                ? { ...tab, meta: { ...tab.meta, lineEnding: ending, mixedLineEndings: false } }
                : tab
            )
          )
      })),
      {
        id: 'window.reload',
        title: 'reload window',
        keys: 'ctrl+r',
        run: () => window.location.reload()
      },
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

      // Chord resolution runs before everything else: once ctrl+k is pending,
      // the next keystroke belongs to the chord whatever it is.
      if (pendingChord === 'ctrl+k') {
        event.preventDefault()
        setPendingChord(null)
        if (mod && event.key.toLowerCase() === 'o') void openFolder()
        return
      }
      if (!mod) return
      if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
        event.preventDefault()
        setPendingChord('ctrl+k')
        return
      }

      // ctrl+shift+p matches every editor's muscle memory. Fighting that is a
      // cost with no upside.
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (event.key === '`') {
        // Ctrl+` is every editor's terminal toggle. Matched on the key itself
        // because it is punctuation and would not match any of the letters.
        event.preventDefault()
        setTerminalStarted(true)
        setTerminalOpen((open) => !open)
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setSidebarVisible((visible) => !visible)
      } else if (event.shiftKey === false && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setQuickOpen((open) => !open)
      } else if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (active) void closeTab(active.path)
      } else if (event.key === 'Tab') {
        event.preventDefault()
        cycleTab(event.shiftKey ? -1 : 1)
      }
      // ctrl+s is bound inside CodeMirror's keymap so it works while typing;
      // duplicating it here would fire the save twice.
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, closeTab, cycleTab, pendingChord, openFolder])

  // A pending chord that never resolves would swallow the next keystroke
  // silently, so it expires.
  useEffect(() => {
    if (pendingChord === null) return
    const timer = setTimeout(() => setPendingChord(null), 2000)
    return () => clearTimeout(timer)
  }, [pendingChord])

  return (
    <div className="relative flex h-full flex-col">
      <TitleBar root={root} onOpenPalette={() => setPaletteOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <ActivityBar containers={containers} activeId="explorer" onSelect={() => undefined} />
        {sidebarVisible && (
          <FileTree
            root={root}
            activePath={activePath}
            onOpenFile={(path) => void openFile(path)}
            onOpenFolder={() => void openFolder()}
            onContextMenu={(entry, event) => {
              event.preventDefault()
              const items = fileOperations(entry)
              if (items.length > 0) setMenu({ x: event.clientX, y: event.clientY, items })
            }}
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
                  title={tab.path}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <Icon name={iconForPath(tab.name)} size={14} className="shrink-0 opacity-80" />
                  {/* dir="auto" sits on the text node, never on the flex row —
                      on a container it would reverse the icon and the name for
                      an Arabic filename. */}
                  <span dir="auto" className="max-w-48 truncate text-[13px]">
                    {tab.name}
                  </span>
                </button>
                <button
                  onClick={() => void closeTab(tab.path)}
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
              docId={active.path}
              openDocIds={openDocIds}
              rootPath={root}
              value={active.content}
              language={languageForPath(active.path)}
              onChange={(content) =>
                setTabs((current) =>
                  current.map((tab) => (tab.path === active.path ? { ...tab, content } : tab))
                )
              }
              onSave={() => void save()}
              initialCursor={cursors[active.path]}
              onCursor={(position) => {
                setCursor(position)
                setCursors((current) => ({
                  ...current,
                  [active.path]: { line: position.line, column: position.column }
                }))
              }}
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

        {/* Kept mounted once opened and hidden with CSS rather than unmounted,
            so toggling the panel away does not kill a shell mid-command. */}
        {terminalStarted && (
          <div
            className="border-line bg-obsidian shrink-0 border-t"
            style={{ height: terminalOpen ? '15rem' : 0, overflow: 'hidden' }}
          >
            <div
              className="border-line text-ink-dim flex items-center justify-between border-b px-3 text-[10px] font-medium uppercase"
              style={{ letterSpacing: '0.14em', height: 'var(--statusbar-h)' }}
            >
              <span>terminal</span>
              <button
                onClick={() => setTerminalOpen(false)}
                aria-label="hide terminal"
                className="hover:text-ink transition-colors"
                style={{ transitionDuration: 'var(--dur-micro)' }}
              >
                ×
              </button>
            </div>
            <div style={{ height: `calc(100% - var(--statusbar-h))` }}>
              <TerminalPanel visible={terminalOpen} onExit={() => setTerminalOpen(false)} />
            </div>
          </div>
        )}

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
              {/* Only for files a server actually handles — on a markdown file
                  "lsp: stopped" would report a problem that does not exist. */}
              {hasLanguageServer(languageForPath(active.path)) && lspState !== 'running' && (
                <span className={lspState === 'failed' ? 'text-error' : 'text-ink-dim'}>
                  {lspState === 'starting' ? 'starting language server' : `language server ${lspState}`}
                </span>
              )}
            </>
          )}
            <span className="ms-auto truncate ps-4">
              {pendingChord !== null ? (
                // Otherwise a pending chord silently swallows your next
                // keystroke and you have no idea why nothing happened.
                <span className="text-ember">{pendingChord} — waiting for second key</span>
              ) : (
                notice && (
                  <span className={notice.kind === 'error' ? 'text-error' : ''}>{notice.text}</span>
                )
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
      <QuickOpen
        open={quickOpen}
        root={root}
        onPick={openRelative}
        onClose={() => setQuickOpen(false)}
      />
      <Prompt request={prompt} onClose={() => setPrompt(null)} />
      <ContextMenu request={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
