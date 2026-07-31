import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/**
 * The terminal panel.
 *
 * Everything hard about a terminal is in the pseudo-terminal, which lives in
 * main. This side is xterm.js drawing bytes and sending keystrokes back, plus
 * the one thing people notice when it is missing: telling the shell how wide
 * it now is.
 */

/** Claven Dark, mapped onto the sixteen colours a terminal expects. */
const THEME = {
  background: '#0F1115',
  foreground: '#E8E6E1',
  cursor: '#FF5A2B',
  cursorAccent: '#0F1115',
  selectionBackground: '#3D424C',
  black: '#16191F',
  red: '#E5484D',
  green: '#5FBF7A',
  yellow: '#F0B429',
  blue: '#5AD1E6',
  magenta: '#C8A2FF',
  cyan: '#5AD1E6',
  white: '#E8E6E1',
  brightBlack: '#6B7280',
  brightRed: '#E5484D',
  brightGreen: '#5FBF7A',
  brightYellow: '#F0B429',
  brightBlue: '#5AD1E6',
  brightMagenta: '#C8A2FF',
  brightCyan: '#5AD1E6',
  brightWhite: '#FFFFFF'
}

type Props = {
  /** Hidden rather than unmounted, so scrollback and shell state survive a toggle. */
  visible: boolean
  /**
   * The shell ended. Called with its exit code, or -1 if it never started.
   * The pane is expected to stay: this reports, it does not close.
   */
  onExit: (code: number) => void
  /** The shell actually spawned, so the tab can be named after it. */
  onStart: (shell: string) => void
}

export function TerminalView({ visible, onExit, onStart }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const sessionId = useRef<string | null>(null)
  const latestExit = useRef(onExit)
  latestExit.current = onExit
  const latestStart = useRef(onStart)
  latestStart.current = onStart

  useEffect(() => {
    if (host.current === null) return
    // Captured once: the cleanup runs after the ref may have been cleared, and
    // removing a listener from null is not a thing.
    const element = host.current

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      theme: THEME,
      cursorBlink: true,
      // Scrollback costs memory and nobody reads 10,000 lines back. Plenty for
      // a build log, cheap on a machine with 4GB.
      scrollback: 5000,
      allowProposedApi: true
    })
    /**
     * Copy takes the selection with it.
     *
     * This is what makes Ctrl+C safe to bind at all: the selection is consumed,
     * so pressing it twice copies once and then interrupts. Leaving the
     * selection behind would mean a stray highlight silently disarms your
     * interrupt, and finding that out mid-runaway-process is the worst possible
     * moment.
     */
    const copySelection = (): boolean => {
      if (!terminal.hasSelection()) return false
      const text = terminal.getSelection()
      terminal.clearSelection()
      if (text.length === 0) return false
      void window.claven.invoke('clipboard:write', { text })
      return true
    }

    const paste = (): void => {
      void window.claven.invoke('clipboard:read', {}).then((result) => {
        // paste() rather than input(): it applies bracketed-paste wrapping, so
        // a shell that supports it knows the text was pasted rather than typed
        // and does not run each line as it arrives.
        if (result.ok && result.value.text.length > 0) terminal.paste(result.value.text)
      })
    }

    /**
     * What the terminal keeps, and what it lets through.
     *
     * xterm calls `stopPropagation` on any key it handles, and it handles every
     * control character. `Ctrl+J` is one of them, so with the terminal focused
     * it went to the shell as a line feed and the shortcut that hides the
     * terminal did nothing from inside the terminal, which is the one place you
     * would press it. Returning false tells xterm to leave the event alone, so
     * it bubbles to the window listener.
     *
     * Let through: the shortcuts that only move panels and focus around, plus
     * copy and paste. Kept for the shell: Ctrl+W deletes a word and Ctrl+S
     * freezes output, and an editor that quietly ate those would be worse than
     * one with no shortcuts at all. Ctrl+C is the one that goes both ways, and
     * is explained where it is handled.
     */
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (!event.ctrlKey && !event.metaKey) return true
      const key = event.key.toLowerCase()

      if (event.shiftKey) {
        // The explicit pair, for when you would rather not think about whether
        // anything is selected.
        if (key === 'c') return !copySelection()
        if (key === 'v') {
          paste()
          return false
        }
        return key !== 'p' && key !== 'f'
      }

      /**
       * Ctrl+C copies a selection and interrupts when there is none.
       *
       * This amends the rule written a few hours earlier that Ctrl+C always
       * stays the shell's. Settled 2026-07-31 by Adam, on the grounds that it
       * is what he already uses elsewhere. The interrupt is not weakened: with
       * nothing selected the key reaches the shell exactly as before, and a
       * copy always clears the selection so the next press interrupts.
       */
      if (key === 'c') return !copySelection()

      return key !== 'j' && key !== 'b' && key !== 'p'
    })

    /**
     * Right-click copies if something is selected, and pastes if not.
     *
     * One button for both, so there is nothing to remember. Windows terminals
     * have behaved this way for long enough that it is muscle memory, and the
     * alternative is a menu in the way of a two-word operation.
     */
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      if (!copySelection()) paste()
    }

    element.addEventListener('contextmenu', onContextMenu)

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(element)
    term.current = terminal
    fit.current = fitAddon

    let disposed = false
    const unsubscribers: Array<() => void> = []
    let pending: ResizeObserver | null = null

    /**
     * Do not start a shell into a box that has not been laid out yet.
     *
     * Fitting a zero-sized element makes xterm one column by one row, and the
     * shell then prints its first prompt one character wide. Resizing it
     * afterwards does not redraw what it already printed, so you are left
     * looking at `PS >` and wondering what happened. Panes are measured a frame
     * after they mount, so this is the normal case now, not a slow-machine one.
     */
    const sized = new Promise<void>((resolve) => {
      if (element.offsetWidth > 0 && element.offsetHeight > 0) {
        resolve()
        return
      }
      pending = new ResizeObserver(() => {
        if (element.offsetWidth > 0 && element.offsetHeight > 0) {
          pending?.disconnect()
          resolve()
        }
      })
      pending.observe(element)
    })

    /**
     * Subscribed before the shell is started, not after.
     *
     * `pty:start` is a full IPC round trip, and main attaches its own data
     * listener the instant the process spawns. Anything the shell said in
     * between used to be sent to a channel nobody was listening on and dropped.
     * For output that means a missing first prompt. For an exit it means the
     * pane stays, looking alive, silently swallowing every keystroke, because
     * the exit that would have told it otherwise was the message that got lost.
     *
     * The id is not known yet, so everything is held and replayed once it is.
     */
    let attached: string | null = null
    const early: Array<{ id: string; data: string }> = []
    const earlyExit: { missed: { id: string; code: number } | null } = { missed: null }

    /**
     * Flow control.
     *
     * xterm's write buffer discards at 50 MB and throws while doing it, and its
     * own source notes it is typically unresponsive a hundred times below that.
     * `git log -p` on a real repo gets there. So the shell is paused once
     * enough unparsed output has piled up and resumed when it drains, which is
     * what node-pty's pause and resume are for.
     */
    let outstanding = 0
    let paused = false
    const HIGH_WATER = 1_000_000
    const LOW_WATER = 200_000

    const consume = (id: string, data: string): void => {
      outstanding += data.length
      if (!paused && outstanding > HIGH_WATER) {
        paused = true
        void window.claven.invoke('pty:setPaused', { id, paused: true })
      }
      terminal.write(data, () => {
        outstanding -= data.length
        if (paused && outstanding < LOW_WATER) {
          paused = false
          void window.claven.invoke('pty:setPaused', { id, paused: false })
        }
      })
    }

    const finish = (code: number): void => {
      sessionId.current = null
      // The pane stays. The exit code and whatever the command printed before
      // dying are usually the thing the terminal was open to read, and closing
      // the pane threw both away along with the scrollback.
      terminal.writeln(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m`)
      latestExit.current(code)
    }

    unsubscribers.push(
      window.claven.subscribe('pty:data', (payload) => {
        if (attached === null) early.push(payload)
        else if (payload.id === attached) consume(attached, payload.data)
      }),
      window.claven.subscribe('pty:exit', (payload) => {
        if (attached === null) earlyExit.missed = payload
        else if (payload.id === attached) finish(payload.code)
      })
    )

    void (async () => {
      await sized
      if (disposed) return
      // Fit before starting, so the shell is told the right size from its very
      // first prompt rather than being resized a moment later.
      fitAddon.fit()
      const started = await window.claven.invoke('pty:start', {
        cols: terminal.cols,
        rows: terminal.rows
      })
      if (!started.ok) {
        terminal.writeln(`\x1b[31mcould not start a shell: ${started.error.message}\x1b[0m`)
        // Reported as an exit rather than left as a dead pane. The pane keeps
        // the message and offers a restart, which is the only way out of a
        // shell that failed to spawn.
        latestExit.current(-1)
        return
      }
      if (disposed) {
        void window.claven.invoke('pty:kill', { id: started.value.id })
        return
      }
      const id = started.value.id
      sessionId.current = id
      attached = id
      latestStart.current(started.value.shell)

      for (const payload of early) {
        if (payload.id === id) consume(id, payload.data)
      }
      early.length = 0

      terminal.onData((data) => {
        void window.claven.invoke('pty:write', { id, data })
      })

      if (earlyExit.missed !== null && earlyExit.missed.id === id) finish(earlyExit.missed.code)
    })()

    return () => {
      disposed = true
      element.removeEventListener('contextmenu', onContextMenu)
      pending?.disconnect()
      for (const off of unsubscribers) off()
      if (sessionId.current !== null) {
        void window.claven.invoke('pty:kill', { id: sessionId.current })
      }
      terminal.dispose()
      term.current = null
      fit.current = null
    }
  }, [])

  /**
   * Keep the shell's idea of the size in step with the panel's.
   *
   * A ResizeObserver rather than a window listener: the panel also changes
   * width when the sidebar is toggled, which the window never hears about.
   */
  useEffect(() => {
    if (host.current === null) return
    const resize = (): void => {
      const terminal = term.current
      if (terminal === null || fit.current === null || host.current === null) return
      // Fitting a hidden element measures zero and leaves the terminal 1x1, and
      // it does not recover on its own. Size rather than offsetParent is the
      // check that matters: a terminal parked off screen while hidden still has
      // an offsetParent, and refitting it to 1x1 would reflow whatever is
      // running in it.
      if (host.current.offsetParent === null) return
      if (host.current.offsetWidth === 0 || host.current.offsetHeight === 0) return
      fit.current.fit()
      if (sessionId.current !== null) {
        void window.claven.invoke('pty:resize', {
          id: sessionId.current,
          cols: terminal.cols,
          rows: terminal.rows
        })
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])

  // Refit and take focus when the panel is revealed. While hidden it was not
  // measurable, so its size is whatever it was when it was last on screen.
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => {
      if (host.current === null || host.current.offsetParent === null) return
      if (host.current.offsetWidth === 0 || host.current.offsetHeight === 0) return
      fit.current?.fit()
      term.current?.focus()
      if (sessionId.current !== null && term.current !== null) {
        void window.claven.invoke('pty:resize', {
          id: sessionId.current,
          cols: term.current.cols,
          rows: term.current.rows
        })
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [visible])

  return <div ref={host} className="h-full w-full overflow-hidden px-2 py-1" />
}
