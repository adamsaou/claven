import { Icon, type IconKey } from './Icons'

export type Container = {
  id: string
  /** Lowercase, per BRAND.md voice. */
  label: string
  icon: IconKey
  /** Rendered as a count on the icon. Omit for none. */
  badge?: number
}

type Props = {
  containers: Container[]
  activeId: string
  onSelect: (id: string) => void
}

/**
 * The activity bar — and the decision to hide it until it has a job.
 *
 * It renders null while there is fewer than one thing to switch to. Claven has
 * a file tree and nothing else: no project search, no source control, no
 * debugger. The three alternatives were considered and rejected:
 *
 *   - Placeholders ("source control — coming soon") advertise software that
 *     does not exist, in a product whose voice rule is anti-marketing, and they
 *     train you to ignore the strip, which is the one habit that makes it
 *     useless later.
 *   - Genuinely-minimal versions of the missing panels are worse than nothing:
 *     half a project search answers questions wrongly rather than not at all.
 *   - Ship-one-and-grow leaves 48px of permanent chrome with no information in
 *     it, and the ember active bar lit 100% of the time — spending the accent
 *     on a constant. Ctrl+B already toggles the only panel there is.
 *
 * The gate costs nothing: the component is built and specified, the layout
 * budget is reserved, and the strip appears by itself the moment a second
 * container registers. Diagnostics at M3 is the expected one — LSP publishes
 * them and the badge below exists for exactly that count.
 *
 * Named cost, so this is not a free lunch: there is a one-time horizontal
 * layout shift when the second container arrives.
 */
export function ActivityBar({ containers, activeId, onSelect }: Props): React.JSX.Element | null {
  if (containers.length < 2) return null

  return (
    <nav
      aria-label="views"
      className="bg-surface-1 border-line flex w-12 shrink-0 flex-col items-stretch border-e"
    >
      {containers.map((container) => {
        const isActive = container.id === activeId
        return (
          <button
            key={container.id}
            onClick={() => onSelect(container.id)}
            title={container.label}
            aria-label={container.label}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex h-12 items-center justify-center transition-colors ${
              isActive ? 'text-ink' : 'text-ink-dim hover:text-ink-muted'
            }`}
            style={{ transitionDuration: 'var(--dur-micro)' }}
          >
            {/* Same 2px ember rail as the active tab and the open file, so all
                three chrome surfaces agree about what is focused. */}
            {isActive && <span className="bg-ember absolute inset-y-2 start-0 w-0.5" />}
            <Icon name={container.icon} size={20} />
            {container.badge !== undefined && container.badge > 0 && (
              <span className="bg-ember text-obsidian absolute end-2 top-2 min-w-4 px-1 text-center text-[10px] leading-4 tabular-nums">
                {container.badge > 99 ? '99+' : container.badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
