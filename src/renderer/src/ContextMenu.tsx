import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  | { kind: 'separator' }
  | { kind: 'item'; label: string; danger?: boolean; run: () => void }

export type MenuRequest = { x: number; y: number; items: MenuItem[] }

type Props = {
  request: MenuRequest | null
  onClose: () => void
}

export function ContextMenu({ request, onClose }: Props): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  // Flip rather than overflow: a menu opened near the bottom-right edge must
  // stay on screen, and there is no scrolling out of a fixed overlay.
  useLayoutEffect(() => {
    if (request === null || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPosition({
      x: request.x + width > window.innerWidth ? Math.max(0, request.x - width) : request.x,
      y: request.y + height > window.innerHeight ? Math.max(0, request.y - height) : request.y
    })
  }, [request])

  useEffect(() => {
    if (request === null) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', dismiss)
    // Any scroll invalidates the anchor position, so close rather than drift.
    window.addEventListener('wheel', onClose, { once: true })
    return () => {
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('wheel', onClose)
    }
  }, [request, onClose])

  if (request === null) return null

  return (
    <div className="absolute inset-0 z-50" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        role="menu"
        className="border-line bg-surface-1 absolute min-w-44 border py-1"
        style={{ left: position.x, top: position.y, borderRadius: 'var(--radius-xs)' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {request.items.map((item, index) =>
          item.kind === 'separator' ? (
            <div key={index} className="bg-line my-1 h-px" />
          ) : (
            <button
              key={index}
              role="menuitem"
              onClick={() => {
                onClose()
                item.run()
              }}
              className={`hover:bg-surface-2 flex w-full items-center px-3 py-1 text-start text-[13px] transition-colors ${
                item.danger ? 'text-error' : 'text-ink-muted hover:text-ink'
              }`}
              style={{ transitionDuration: 'var(--dur-micro)' }}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
