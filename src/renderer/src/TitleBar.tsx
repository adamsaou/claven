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

type Props = {
  /** Filename of the focused file, or null when nothing is open. */
  title: string | null
  dirty: boolean
}

export function TitleBar({ title, dirty }: Props): React.JSX.Element {
  return (
    <div
      className="bg-surface-1 border-line relative z-10 shrink-0 border-b"
      style={{ height: 'var(--titlebar-h)' }}
    >
      <div
        className="absolute flex items-center gap-2 px-3"
        style={{
          // Confine content to the region Windows has left us.
          insetInlineStart: 'env(titlebar-area-x, 0px)',
          top: 'env(titlebar-area-y, 0px)',
          width: 'env(titlebar-area-width, 100%)',
          height: 'env(titlebar-area-height, var(--titlebar-h))',
          // Drag the window from anywhere in the bar.
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
        {/* The mark, mono. BRAND.md: below 20px always use the mono version --
            the two-tone puts an ember wedge against a paper wedge across a
            diagonal, and at this size that boundary reads as mud. */}
        <svg
          viewBox="0 0 96 96"
          className="text-ink shrink-0"
          width="15"
          height="15"
          aria-hidden="true"
        >
          <path d="M8 8 H62 L34 88 H8 Z" fill="currentColor" />
          <path d="M72 8 H88 V88 H44 Z" fill="currentColor" />
        </svg>

        <span
          dir="auto"
          className="text-ink-muted truncate text-[12px]"
          title={title ?? undefined}
        >
          {title === null ? 'claven' : `${dirty ? '● ' : ''}${title}`}
        </span>
      </div>
    </div>
  )
}
