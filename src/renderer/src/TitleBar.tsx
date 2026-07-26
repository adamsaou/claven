/**
 * Custom title bar.
 *
 * The window is created with `titleBarStyle: 'hidden'` plus `titleBarOverlay`,
 * so Windows still draws the real minimise/maximise/close buttons over the
 * top-right — we just theme them. Everything left of that is ours.
 *
 * Layout uses the Window Controls Overlay env() variables rather than a
 * hardcoded gutter, because the controls are a different width on Windows and
 * Linux, move to the left under RTL system settings, and change size with the
 * display scale. A magic 140px would be wrong on most of those.
 */

import { Icon } from './Icons'

type Props = {
  /** Absolute path of the open workspace, or null. */
  root: string | null
  onOpenPalette: () => void
}

/**
 * Shows the WORKSPACE, not the filename.
 *
 * The tab strip and the status bar already say which file is focused; a third
 * copy in the title bar is wasted chrome. VS Code makes the same call — its
 * command centre names the folder, not the file.
 */
export function TitleBar({ root, onOpenPalette }: Props): React.JSX.Element {
  const name = root === null ? null : (root.split(/[\\/]/).filter(Boolean).pop() ?? root)

  return (
    <div
      className="bg-surface-1 border-line relative z-10 shrink-0 border-b"
      style={{ height: 'var(--titlebar-h)' }}
    >
      <div
        className="absolute flex items-center px-3"
        style={
          {
            // Confine content to the region Windows has left us.
            insetInlineStart: 'env(titlebar-area-x, 0px)',
            top: 'env(titlebar-area-y, 0px)',
            width: 'env(titlebar-area-width, 100%)',
            height: 'env(titlebar-area-height, var(--titlebar-h))',
            // Drag the window from anywhere in the bar.
            WebkitAppRegion: 'drag'
          } as React.CSSProperties
        }
      >
        {/* The mark, mono. BRAND.md: below 20px always use the mono version —
            the two-tone puts an ember wedge against a paper wedge across a
            diagonal, and at this size that boundary reads as mud. */}
        <svg viewBox="0 0 96 96" className="text-ink shrink-0" width="15" height="15" aria-hidden="true">
          <path d="M8 8 H62 L34 88 H8 Z" fill="currentColor" />
          <path d="M72 8 H88 V88 H44 Z" fill="currentColor" />
        </svg>

        {/* Command centre.
            With no menu bar on Windows and Linux, this is the only visible
            entry point to the palette — it is what makes the command list
            discoverable to someone who never learned ctrl+shift+p, and that is
            precisely what earns dropping File/Edit/View. no-drag so it stays
            clickable inside a drag region. */}
        <button
          onClick={onOpenPalette}
          title="command palette — ctrl+shift+p"
          className="border-line text-ink-dim hover:border-ink-dim hover:text-ink-muted absolute inset-x-0 mx-auto flex h-[22px] w-[min(28rem,42%)] items-center gap-2 border px-2 transition-colors"
          style={
            {
              borderRadius: 'var(--radius-xs)',
              transitionDuration: 'var(--dur-micro)',
              WebkitAppRegion: 'no-drag'
            } as React.CSSProperties
          }
        >
          <Icon name="search" size={11} className="shrink-0 opacity-70" />
          <span dir="auto" className="truncate text-[12px]">
            {name ?? 'claven'}
          </span>
        </button>
      </div>
    </div>
  )
}
