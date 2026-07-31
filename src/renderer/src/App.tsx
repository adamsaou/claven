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
import { Workbench, type Rect, type TabView } from './layout/Workbench'
import { SurfaceLayer, type Surface } from './layout/SurfaceLayer'
import { useLayout } from './layout/useLayout'
import { TerminalView } from './terminal/TerminalView'
import type { Pane } from '../../shared/layout'
import { SearchPanel } from './SearchPanel'
import { CodeMirrorEditor, languageForPath, type CursorPosition } from './editor/CodeMirrorEditor'
import type { FileMeta } from '../../shared/files'

type Doc = {
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
  /**
   * Every open document, keyed by path. Which pane shows which of them, and
   * which one is on top in each, is the layout's business rather than this
   * list's: a document is open once, no matter how many panes exist.
   */
  const [docs, setDocs] = useState<Doc[]>([])
  const [notice, setNotice] = useState<Notice>(null)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1, selected: 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [menu, setMenu] = useState<MenuRequest | null>(null)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [pendingChord, setPendingChord] = useState<string | null>(null)
  /**
   * The split tree, and where every pane currently is on screen. The rects are
   * measured by the workbench and consumed by the surface layer, which is the
   * only way a terminal can move between panes without being unmounted and
   * having its shell killed. See SurfaceLayer.tsx.
   */
  const layout = useLayout()
  const [paneRects, setPaneRects] = useState<Record<string, Rect>>({})
  const [dragActive, setDragActive] = useState(false)
  const [sidebarView, setSidebarView] = useState<'explorer' | 'search'>('explorer')
  /**
   * Where to put the cursor after opening a file from a search result. The nonce
   * makes clicking the same hit twice reveal it again, which a plain
   * {path,line,column} would not.
   */
  const [revealAt, setRevealAt] = useState<
    { path: string; line: number; column: number; nonce: number } | null
  >(null)
  /** The same key FileTree writes, so the two sidebar views are the same width. */
  const [sidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('claven.sidebar.width'))
    return Number.isFinite(stored) && stored >= 140 ? stored : 200
  })

  /**
   * Two containers now, so the activity bar stops rendering null and appears
   * for the first time. Its documented one-time horizontal layout shift lands
   * here, which is also why FileTree's resize handle measures from its own left
   * edge rather than from the window's.
   */
  const containers: Container[] = [
    { id: 'explorer', label: 'explorer', icon: 'explorer' },
    { id: 'search', label: 'search', icon: 'search' }
  ]

  const activePath = layout.activePath
  const docFor = (path: string | null): Doc | null =>
    path === null ? null : (docs.find((doc) => doc.path === path) ?? null)
  const active = docFor(activePath)
  const dirty = active !== null && active.content !== active.saved
  const openDocIds = useMemo(() => docs.map((doc) => doc.path), [docs])

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
      // Before the files, so the panes are already in place when the editor
      // gets something to draw and does not have to be measured twice.
      layout.restore(session.layout)

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
      const usable = opened.filter((doc): doc is Doc => doc !== null)

      /**
       * Put unsaved edits back.
       *
       * `saved` deliberately stays as what is on disk right now, not as what
       * was on disk when the backup was taken. The tab therefore comes back
       * dirty, which is the truth, and if the file changed underneath in the
       * meantime the mtime guard and the conflict dialog handle it exactly as
       * they would have done had the app never closed.
       */
      const backups = await window.claven.invoke('buffer:restore', {})
      const byPath = new Map(
        backups.ok ? backups.value.buffers.map((buffer) => [buffer.path, buffer]) : []
      )
      const withEdits = usable.map((doc) => {
        const backup = byPath.get(doc.path)
        return backup === undefined ? doc : { ...doc, content: backup.content }
      })
      const restoredCount = withEdits.filter((doc) => doc.content !== doc.saved).length
      if (restoredCount > 0) {
        setNotice({
          kind: 'info',
          text: `restored ${restoredCount} unsaved ${restoredCount === 1 ? 'file' : 'files'}`
        })
      }
      setDocs(withEdits)
      // The layout says where each file goes. Reconciling drops any pane entry
      // whose file has since been deleted, and finds a home for anything the
      // layout has never heard of, which is every file in a session written
      // before layouts were stored at all.
      layout.reconcileFiles(
        withEdits.map((doc) => doc.path),
        session.activePath
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
          openPaths: docs.map((doc) => doc.path),
          activePath,
          cursors,
          layout: layout.layout
        }
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [restored, root, docs, activePath, cursors, layout.layout])

  // The window title is the fastest way to know which file is focused when
  // Claven is one of eight things in the taskbar.
  useEffect(() => {
    document.title = active ? `${dirty ? '● ' : ''}${active.name} — Claven` : 'Claven'
  }, [active, dirty])

  // Switching to a file that is scrolled off-screen should bring it into view.
  // Queried rather than held in a ref: there is a strip per pane now, and the
  // one that matters is whichever holds the file that just became active.
  useEffect(() => {
    if (activePath === null) return
    document
      .querySelector(`[data-tab="${CSS.escape(activePath)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activePath])

  const openFolder = useCallback(async () => {
    const result = await window.claven.invoke('workspace:open', {})
    if (!result.ok) setNotice({ kind: 'error', text: result.error.message })
  }, [])

  /**
   * Open a file, and hand back the path it actually settled on.
   *
   * The return value is not a convenience. Callers pass paths built with a
   * forward slash while documents are keyed on the platform-separator path main
   * resolved, so a caller that then wants to do something with "the tab it just
   * opened" has to be told which one that is. Search's reveal-the-hit silently
   * did nothing for exactly this reason: its path never equalled the tab's.
   */
  const openFile = useCallback(
    async (path: string): Promise<string | null> => {
      if (docs.some((doc) => doc.path === path)) {
        layout.openInFocused(path)
        return path
      }
      const result = await window.claven.invoke('fs:read', { path })
      if (!result.ok) {
        setNotice({ kind: 'error', text: result.error.message })
        return null
      }
      const value = result.value
      const name = path.split(/[\\/]/).pop() ?? path
      if (value.kind === 'binary') {
        setNotice({ kind: 'info', text: `${name} is binary` })
        return null
      }
      if (value.kind === 'too-large') {
        setNotice({
          kind: 'info',
          text: `${name} is ${(value.size / 1024 / 1024).toFixed(1)} mb, over the ${value.limit / 1024 / 1024} mb limit`
        })
        return null
      }
      /**
       * Key the tab on the path main resolved, never on the one the caller
       * typed. The tree builds paths with the platform separator and quick-open
       * joins with a forward slash, so the same file arrived under two different
       * strings and opened twice — two tabs, two edit buffers, and whichever
       * saved second failed the changed-on-disk check.
       */
      const canonical = value.meta.path
      const existing = docs.find((doc) => doc.path === canonical)
      if (existing !== undefined) {
        layout.openInFocused(canonical)
        return canonical
      }
      setDocs((current) => [
        ...current,
        {
          path: canonical,
          name: canonical.split(/[\\/]/).pop() ?? name,
          content: value.content,
          saved: value.content,
          meta: value.meta
        }
      ])
      layout.openInFocused(canonical)
      setNotice(
        value.meta.mixedLineEndings
          ? { kind: 'info', text: `mixed line endings — saving normalises to ${value.meta.lineEnding}` }
          : null
      )
      return canonical
    },
    [docs, layout]
  )

  /** Throw away the buffer and take what is on disk. Only ever called with consent. */
  const reloadFromDisk = useCallback(async (path: string) => {
    const result = await window.claven.invoke('fs:read', { path })
    if (!result.ok || result.value.kind !== 'text') {
      setNotice({ kind: 'error', text: `could not reload ${path}` })
      return
    }
    const { content, meta } = result.value
    setDocs((current) =>
      current.map((doc) => (doc.path === path ? { ...doc, content, saved: content, meta } : doc))
    )
    setNotice({ kind: 'info', text: 'reloaded from disk' })
  }, [])

  /**
   * A file open in the editor changed outside it.
   *
   * A clean tab reloads without asking, because there is nothing of yours to
   * lose and silently showing you stale content is the worse option. A dirty
   * tab is left exactly as it is and only flagged: choosing between your edits
   * and theirs is a decision, and the save path already has a dialog for it.
   */
  useEffect(
    () =>
      window.claven.subscribe('file:changed-on-disk', (payload) => {
        setDocs((current) => {
          const doc = current.find((candidate) => candidate.path === payload.path)
          if (doc === undefined) return current
          if (doc.content !== doc.saved) {
            setNotice({ kind: 'error', text: `${doc.name} changed on disk — your copy differs` })
            return current
          }
          void (async () => {
            const result = await window.claven.invoke('fs:read', { path: payload.path })
            if (!result.ok || result.value.kind !== 'text') return
            const { content, meta } = result.value
            setDocs((latest) =>
              latest.map((candidate) =>
                candidate.path === payload.path
                  ? { ...candidate, content, saved: content, meta }
                  : candidate
              )
            )
            setNotice({ kind: 'info', text: `${doc.name} reloaded from disk` })
          })()
          return current
        })
      }),
    []
  )

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
    setDocs((current) =>
      current.map((doc) => (doc.path === active.path ? { ...doc, saved: doc.content, meta } : doc))
    )
    // "Opened 2.1 GB in 0.8s." — state what happened and how long it took.
    setNotice({ kind: 'info', text: `saved in ${Math.round(performance.now() - started)}ms` })
  }, [active, reloadFromDisk])

  /**
   * Close documents, and take them out of whichever panes were showing them.
   *
   * The two have to move together. A document left in the layout with nothing
   * behind it draws a tab that opens an empty editor, and a document kept alive
   * with no tab anywhere is a buffer you cannot reach and cannot save.
   */
  const forceCloseTabs = useCallback(
    (matches: (path: string) => boolean) => {
      for (const path of layout.openPaths.filter(matches)) layout.closeFile(path)
      setDocs((current) => current.filter((doc) => !matches(doc.path)))
    },
    [layout]
  )

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
    setDocs((current) =>
      current.map((doc) => {
        const next = moved(doc.path)
        if (next === null) return doc
        return {
          ...doc,
          path: next,
          name: next.split(/[\\/]/).pop() ?? next,
          meta: { ...doc.meta, path: next }
        }
      })
    )
    // The panes hold paths too, so a rename that only fixed the documents would
    // leave every strip pointing at a file that no longer exists.
    layout.remapFiles(moved)
    setCursors((current) =>
      Object.fromEntries(
        Object.entries(current).map(([path, at]) => [moved(path) ?? path, at])
      )
    )
  }, [layout])

  /**
   * Closing a modified tab used to discard the changes silently. That was a
   * data-loss bug, not a missing feature.
   */
  const closeTab = useCallback(
    async (path: string) => {
      const doc = docs.find((candidate) => candidate.path === path)
      if (doc === undefined) return
      if (doc.content === doc.saved) {
        forceCloseTab(path)
        return
      }
      const answer = await window.claven.invoke('dialog:confirmDiscard', { name: doc.name })
      if (!answer.ok || answer.value.action === 'cancel') return
      if (answer.value.action === 'save') {
        const written = await window.claven.invoke('fs:write', {
          path: doc.path,
          content: doc.content,
          meta: doc.meta,
          expectedMtimeMs: doc.meta.mtimeMs
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
    [docs, forceCloseTab]
  )

  /**
   * Tell main which files to watch, and what we believe is on disk.
   *
   * Keyed on the paths and their mtimes rather than on `docs`, because the array
   * array changes identity on every keystroke and this would otherwise reset
   * every watcher in the process several times a second. `meta.mtimeMs` only
   * moves on a read or a write, which is exactly when the baseline should.
   */
  const watchKey = JSON.stringify(docs.map((doc) => [doc.path, doc.meta.mtimeMs]))
  useEffect(() => {
    void window.claven.invoke('watch:files', {
      files: docs.map((doc) => ({ path: doc.path, mtimeMs: doc.meta.mtimeMs }))
    })
    // docs is read through watchKey on purpose; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey])

  /**
   * Back up every dirty buffer, debounced.
   *
   * Long enough not to write on every keystroke, short enough that a crash
   * costs a sentence rather than a session. The whole dirty set goes each time
   * so main can delete backups for anything that has since been saved.
   */
  useEffect(() => {
    if (!restored) return
    const timer = setTimeout(() => {
      void window.claven.invoke('buffer:sync', {
        buffers: docs
          .filter((doc) => doc.content !== doc.saved)
          .map((doc) => ({ path: doc.path, content: doc.content, mtimeMs: doc.meta.mtimeMs }))
      })
    }, 700)
    return () => clearTimeout(timer)
  }, [restored, docs])

  // Main cannot see React state, and a renderer cannot veto its own window
  // closing — so the count has to be pushed for the close guard to work.
  //
  // Derived first and pushed on the count, not on `docs`: the array changes
  // identity on every keystroke, and pushing on that meant an IPC round trip
  // per character typed.
  const dirtyCount = docs.filter((doc) => doc.content !== doc.saved).length
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

  // Within the focused pane. Cycling across every open file regardless of where
  // it is would jump the focus between panes on every press.
  const cycleTab = useCallback((delta: number) => layout.cycleInFocused(delta), [layout])

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
        id: 'view.search',
        title: 'search the project',
        keys: 'ctrl+shift+f',
        enabled: root !== null,
        run: () => {
          setSidebarVisible(true)
          setSidebarView('search')
          // Deferred a frame: the panel has to be visible before its input can
          // take focus.
          requestAnimationFrame(() => {
            const box = document.querySelector<HTMLInputElement>('nav[aria-label="search"] input')
            box?.focus()
            box?.select()
          })
        }
      },
      {
        id: 'view.toggleTerminal',
        title: 'toggle terminal',
        keys: 'ctrl+j',
        run: layout.toggleTerminals
      },
      {
        // The keyboard route to what dragging a tab does, and the only route
        // when a pane holds one file: dropping that tab back on its own pane
        // is deliberately a no-op, so there would be nothing to drag.
        id: 'view.splitEditor',
        title: 'split editor',
        keys: 'ctrl+\\',
        run: layout.splitFocusedEditor
      },
      {
        id: 'view.resetLayout',
        title: 'reset layout',
        run: layout.reset
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
        id: 'doc.close',
        title: 'close doc',
        keys: 'ctrl+w',
        enabled: active !== null,
        run: () => active && void closeTab(active.path)
      },
      {
        id: 'doc.closeAll',
        title: 'close all docs',
        enabled: docs.length > 0,
        // Sequential on purpose: each dirty tab gets its own prompt rather
        // than one dialog standing in for all of them.
        run: () => void docs.reduce<Promise<void>>(
          (chain, doc) => chain.then(() => closeTab(doc.path)),
          Promise.resolve()
        )
      },
      { id: 'doc.next', title: 'next doc', keys: 'ctrl+doc', enabled: docs.length > 1, run: () => cycleTab(1) },
      // Ranked deliberately high: Windows dev, Linux judges. This is the switch
      // most likely to be needed and least likely to be remembered — exactly
      // what a palette is for.
      ...(['lf', 'crlf', 'cr'] as LineEnding[]).map((ending) => ({
        id: `file.lineEnding.${ending}`,
        title: `change line endings to ${ending}`,
        enabled: active !== null && active.meta.lineEnding !== ending,
        run: (): void =>
          setDocs((current) =>
            current.map((doc) =>
              doc.path === active?.path
                ? { ...doc, meta: { ...doc.meta, lineEnding: ending, mixedLineEndings: false } }
                : doc
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
        id: 'doc.previous',
        title: 'previous doc',
        keys: 'ctrl+shift+doc',
        enabled: docs.length > 1,
        run: () => cycleTab(-1)
      }
    ],
    [
      openFolder,
      save,
      dirty,
      active,
      closeTab,
      docs.length,
      cycleTab,
      layout.toggleTerminals,
      layout.reset,
      layout.splitFocusedEditor
    ]
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
      if (event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSidebarVisible(true)
        setSidebarView('search')
        requestAnimationFrame(() => {
          const box = document.querySelector<HTMLInputElement>('nav[aria-label="search"] input')
          box?.focus()
          box?.select()
        })
      } else if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (event.key.toLowerCase() === 'j') {
        /**
         * Ctrl+J rather than the Ctrl+backtick every editor defaults to.
         *
         * Backtick is a plain key on a US layout and something else nearly
         * everywhere else: a dead key on French and many other European
         * layouts, AltGr on AZERTY. A default that costs one keypress for
         * some people and three for others is not a default, and Claven is
         * written on a machine where it is three.
         *
         * Ctrl+J is VS Code's own panel toggle, so it is still muscle memory,
         * and it is a letter, so it costs the same everywhere.
         */
        event.preventDefault()
        layout.toggleTerminals()
      } else if (event.key === '\\') {
        event.preventDefault()
        layout.splitFocusedEditor()
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
  }, [
    active,
    closeTab,
    cycleTab,
    pendingChord,
    openFolder,
    layout.toggleTerminals,
    layout.splitFocusedEditor
  ])

  // A pending chord that never resolves would swallow the next keystroke
  // silently, so it expires.
  useEffect(() => {
    if (pendingChord === null) return
    const timer = setTimeout(() => setPendingChord(null), 2000)
    return () => clearTimeout(timer)
  }, [pendingChord])

  /**
   * One pane's tabs. Files carry an icon and their dirty dot; terminals are
   * numbered globally by creation, so a terminal keeps its label when you drag
   * it somewhere else.
   */
  const tabsFor = (pane: Pane): TabView[] =>
    pane.content.type === 'editors'
      ? pane.content.items.map((path) => {
          const doc = docFor(path)
          const name = doc?.name ?? (path.split(/[\/]/).pop() ?? path)
          return {
            key: path,
            label: name,
            title: path,
            closeLabel: `close ${name}`,
            dirty: doc !== null && doc.content !== doc.saved,
            icon: <Icon name={iconForPath(name)} size={14} className="shrink-0 opacity-80" />
          }
        })
      : pane.content.items.map((key) => {
          const number = layout.terminalOrder.indexOf(key) + 1
          return {
            key,
            label: String(number),
            closeLabel: `close terminal ${number}`,
            icon: <Icon name="terminal" size={12} className="shrink-0 opacity-80" />
          }
        })

  const emptyEditorState = (
    <div className="text-ink-dim flex h-full flex-col items-center justify-center gap-1 text-[13px]">
      <span>{root === null ? 'no folder open' : 'no file open'}</span>
      <span className="text-ink-dim/70 text-xs">
        {root === null ? 'open a folder to start' : 'pick a file from the tree'}
      </span>
    </div>
  )

  /**
   * One editor per editor pane, showing that pane's current file.
   *
   * Each is its own CodeMirror view with its own state cache, which is why a
   * file lives in exactly one pane: two views over one document would need one
   * shared model underneath, and two that quietly drift apart is a way to lose
   * work rather than a feature.
   */
  const editorSurfaces: Surface[] = layout.editorSlots.map((slot) => {
    const pane = layout.editorPanes.find((candidate) => candidate.id === slot.paneId)
    const doc = docFor(pane?.content.active ?? null)
    return {
      key: slot.key,
      paneId: slot.paneId,
      visible: slot.visible,
      node: (
        <div
          className="h-full w-full"
          // The surfaces are drawn outside the pane boxes, so a click in an
          // editor never reaches the pane's own handler. Focus has to be
          // claimed here or clicking into a pane would not make it the one
          // your next Ctrl+S applies to.
          onMouseDownCapture={() => layout.focusPane(slot.paneId)}
        >
          {doc === null ? null : (
          <CodeMirrorEditor
            docId={doc.path}
            openDocIds={openDocIds}
            rootPath={root}
            value={doc.content}
            language={languageForPath(doc.path)}
            onChange={(content) =>
              setDocs((current) =>
                current.map((candidate) =>
                  candidate.path === doc.path ? { ...candidate, content } : candidate
                )
              )
            }
            onSave={() => void save()}
            initialCursor={cursors[doc.path]}
            revealAt={
              revealAt !== null && revealAt.path === doc.path
                ? { line: revealAt.line, column: revealAt.column, nonce: revealAt.nonce }
                : undefined
            }
            onCursor={(position) => {
              // Only the focused pane drives the status bar. Without the guard
              // a background pane reports its own cursor whenever it is
              // measured, and the numbers flicker between two files.
              if (slot.paneId === layout.focusedPaneId) setCursor(position)
              setCursors((current) => ({
                ...current,
                [doc.path]: { line: position.line, column: position.column }
              }))
            }}
          />
          )}
        </div>
      )
    }
  })

  const terminalSurfaces: Surface[] = layout.terminalSlots.map((slot) => ({
    key: slot.key,
    paneId: slot.paneId,
    visible: slot.visible,
    node: <TerminalView visible={slot.visible} onExit={() => layout.closeTerminal(slot.key)} />
  }))

  return (
    <div className="relative flex h-full flex-col">
      <TitleBar root={root} onOpenPalette={() => setPaletteOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <ActivityBar
          containers={containers}
          // Nothing is lit while the sidebar is closed. An ember rail against a
          // panel that is not on screen says the wrong thing.
          activeId={sidebarVisible ? sidebarView : null}
          onSelect={(id) => {
            const view = id === 'search' ? 'search' : 'explorer'
            // Clicking the container you are already looking at closes the
            // sidebar. Clicking a different one switches to it and opens it.
            if (sidebarVisible && sidebarView === view) {
              setSidebarVisible(false)
              return
            }
            setSidebarView(view)
            setSidebarVisible(true)
          }}
        />
        {sidebarVisible && (
          <>
            {/* Both containers stay mounted and one is hidden, the same decision
                and the same reason as the terminal: switching away must not
                discard a result set that took two seconds to produce, nor the
                folders the tree had expanded.

                `display: contents` on the wrapper, so FileTree carries on owning
                its own width, border and resize handle rather than having a
                second sized box put around it. */}
            <div style={{ display: sidebarView === 'explorer' ? 'contents' : 'none' }}>
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
            </div>
            <nav
              aria-label="search"
              className="border-line bg-surface-1 h-full shrink-0 border-e"
              style={{
                // The width the tree was last dragged to, read from the same key
                // it writes. Not resizable from this view yet.
                width: `${sidebarWidth}px`,
                display: sidebarView === 'search' ? 'block' : 'none'
              }}
            >
              <SearchPanel
                root={root}
                onOpenHit={(file, line, column) => {
                  if (root === null) return
                  const path = `${root}/${file}`
                  // Reveal against the path openFile settled on, never the one
                  // built here: they differ by separator and the comparison in
                  // the editor is exact.
                  void openFile(path).then((opened) => {
                    if (opened !== null) {
                      setRevealAt({ path: opened, line, column, nonce: Date.now() })
                    }
                  })
                }}
              />
            </nav>
          </>
        )}

        <main className="bg-obsidian flex min-w-0 flex-1 flex-col">
          {/* One positioned box holding the tree and the surfaces drawn over
              it. Both measure against this origin, so they have to share it. */}
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <Workbench
              layout={layout.visible}
              onLayout={layout.setLayout}
              focusedPaneId={layout.focusedPaneId}
              onFocusPane={layout.focusPane}
              tabsFor={tabsFor}
              emptyEditorState={emptyEditorState}
              onRects={setPaneRects}
              onDragging={setDragActive}
              onSelectTab={(kind, item) =>
                kind === 'editors' ? layout.activateFile(item) : layout.activateTerminal(item)
              }
              onCloseTab={(kind, item) =>
                kind === 'editors' ? void closeTab(item) : layout.closeTerminal(item)
              }
              onAddTerminal={layout.addTerminalTo}
              onMoveItem={layout.moveItemTo}
            />

            <SurfaceLayer
              rects={paneRects}
              // Editors first, then terminals, and each group in creation
              // order. Appending to a group inserts one node without moving
              // its siblings; reordering would move them, and moving an xterm
              // detaches it.
              surfaces={[...editorSurfaces, ...terminalSurfaces]}
              // A surface covers its pane, so during a drag it would swallow
              // every dragover before the drop zone underneath heard one.
              interactive={!dragActive}
            />
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
