import { useMemo } from 'react'
import { Picker, Highlighted } from './Picker'

export type Command = {
  id: string
  /** Lowercase, terse, verb first — per BRAND.md voice. */
  title: string
  /** Rendered right-aligned. Display only; the real binding lives in the keymap. */
  keys?: string
  enabled?: boolean
  run: () => void
}

type Props = {
  open: boolean
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ open, commands, onClose }: Props): React.JSX.Element | null {
  const available = useMemo(() => commands.filter((c) => c.enabled !== false), [commands])

  return (
    <Picker
      open={open}
      placeholder="type a command"
      items={available}
      keyOf={(command) => command.id}
      searchOf={(command) => command.title}
      emptyLabel="no matching command"
      onPick={(command) => command.run()}
      onClose={onClose}
      renderRow={(command, match, selected) => (
        <>
          <span className="relative flex-1 truncate">
            {selected && <span className="bg-ember absolute inset-y-0 -start-3 w-0.5" />}
            <Highlighted text={command.title} match={match} />
          </span>
          {command.keys !== undefined && (
            <span className="text-ink-dim shrink-0 font-mono text-[11px]">{command.keys}</span>
          )}
        </>
      )}
    />
  )
}
