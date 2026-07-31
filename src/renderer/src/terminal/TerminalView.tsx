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
  onExit: () => void
}

export function TerminalView({ visible, onExit }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const sessionId = useRef<string | null>(null)
  const latestExit = useRef(onExit)
  latestExit.current = onExit

  useEffect(() => {
    if (host.current === null) return

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
     * Let the window's own shortcuts out of the terminal.
     *
     * xterm calls `stopPropagation` on any key it handles, and it handles every
     * control character. `Ctrl+J` is one of them, so with the terminal focused
     * it went to the shell as a line feed and the shortcut that hides the
     * terminal did nothing from inside the terminal. Which is the one place you
     * would press it.
     *
     * Returning false tells xterm to leave the event alone, so it bubbles to
     * the window listener. Kept to the shortcuts that only move panels and
     * focus around. Anything with a real meaning at a prompt stays the shell's:
     * Ctrl+C is an interrupt, Ctrl+W deletes a word, Ctrl+S freezes output, and
     * an editor that quietly ate those would be worse than one with no
     * shortcuts at all.
     */
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (!event.ctrlKey && !event.metaKey) return true
      const key = event.key.toLowerCase()
      if (event.shiftKey) return key !== 'p' && key !== 'f'
      return key !== 'j' && key !== 'b' && key !== 'p'
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host.current)
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
      const element = host.current
      if (element === null) return
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
        return
      }
      if (disposed) {
        void window.claven.invoke('pty:kill', { id: started.value.id })
        return
      }
      const id = started.value.id
      sessionId.current = id

      unsubscribers.push(
        window.claven.subscribe('pty:data', (payload) => {
          if (payload.id === id) terminal.write(payload.data)
        }),
        window.claven.subscribe('pty:exit', (payload) => {
          if (payload.id !== id) return
          sessionId.current = null
          terminal.writeln(`\r\n\x1b[90m[process exited with code ${payload.code}]\x1b[0m`)
          latestExit.current()
        })
      )

      terminal.onData((data) => {
        void window.claven.invoke('pty:write', { id, data })
      })
    })()

    return () => {
      disposed = true
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
