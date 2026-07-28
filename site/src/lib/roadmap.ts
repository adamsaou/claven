export type Status = 'done' | 'current' | 'planned'

export type Milestone = {
  id: string
  title: string
  /** What it is, in one line. */
  detail: string
  /** The condition that makes it finished. Vague milestones never end. */
  doneWhen?: string
  status: Status
}

/**
 * M1–M4 are identical under all four premise candidates — about two months of
 * work that is not blocked on deciding anything. That is deliberate, and it is
 * why the premise question can wait until there is evidence.
 */
export const MILESTONES: Milestone[] = [
  {
    id: 'M1',
    title: 'It opens files',
    detail: 'Window, file tree, editor, tabs, save, session restore.',
    doneWhen: 'A real file edit survives on disk.',
    status: 'done'
  },
  {
    id: 'M2',
    title: 'Does not look like a demo',
    detail: 'Syntax highlighting, the brand theme, fonts, find-in-file.',
    status: 'done'
  },
  {
    id: 'M3',
    title: 'Language servers',
    detail: 'Spawn servers, JSON-RPC framing, diagnostics, completion, hover, go-to-definition.',
    doneWhen: 'A TypeScript error squiggles without saving.',
    status: 'current'
  },
  {
    id: 'M4',
    title: 'Terminal',
    detail: 'A real PTY, and xterm.js in front of it.',
    status: 'planned'
  },
  {
    id: 'M5',
    title: 'Dogfood and decide',
    detail: 'One week with Claven as the only editor, then read the annoyance log and pick the premise.',
    status: 'planned'
  },
  {
    id: 'M6',
    title: 'Agent client',
    detail: 'ACP — the Agent Client Protocol. Premise-neutral, so it can be built before the premise is known.',
    status: 'planned'
  },
  {
    id: 'M7',
    title: 'The premise',
    detail: 'Whatever the log turned out to say.',
    status: 'planned'
  }
]

export const CURRENT = MILESTONES.find((milestone) => milestone.status === 'current') ?? MILESTONES[0]
