/**
 * Architectural boundary check.
 *
 * This exists instead of eslint no-restricted-imports because as of 2026-07-26
 * no typescript-eslint release supports TypeScript 7 (latest is 8.65.0, peer
 * capped at <6.1.0, no v9). Rather than downgrade TypeScript or leave the rule
 * unenforced until the ecosystem catches up, the one rule that actually matters
 * is checked here with no dependencies. Replace with eslint when it can parse
 * TS 7.
 *
 *   node tests/check-boundaries.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const RULES = [
  {
    // The whole point of the adapter. Decoration, WidgetType and ViewPlugin all
    // live in @codemirror/view, so every feature that draws is tempted to reach
    // across. Once it does, "replace the renderer later" quietly stops being an
    // option -- which is the entire reason CodeMirror was chosen over writing one.
    pattern: /from\s+['"]@codemirror\/view['"]/,
    within: 'src/renderer',
    allow: ['src/renderer/src/editor/CodeMirrorEditor.tsx'],
    message: '@codemirror/view may only be imported by the editor adapter'
  },
  {
    // The renderer is sandboxed, so this should be impossible -- but an import
    // that looks harmless is how sandboxing gets quietly turned off later.
    pattern: /from\s+['"](electron|node:[a-z]+)['"]/,
    within: 'src/renderer',
    allow: [],
    message: 'the renderer must not import electron or node builtins — go through the IPC contract'
  },
  {
    // Main owns the filesystem and process spawning; it has no business
    // importing UI. Catches an accidental cross-wire early.
    pattern: /from\s+['"]react(-dom)?['"]/,
    within: 'src/main',
    allow: [],
    message: 'the main process must not import react'
  }
]

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full
  }
}

let violations = 0
for (const rule of RULES) {
  for await (const file of walk(join(root, rule.within))) {
    const rel = relative(root, file).split(sep).join('/')
    if (rule.allow.includes(rel)) continue
    const source = await readFile(file, 'utf8')
    source.split('\n').forEach((line, index) => {
      if (rule.pattern.test(line)) {
        console.error(`${rel}:${index + 1}  ${rule.message}\n    ${line.trim()}`)
        violations += 1
      }
    })
  }
}

if (violations > 0) {
  console.error(`\n${violations} boundary violation${violations === 1 ? '' : 's'}`)
  process.exit(1)
}
console.log(`boundaries ok — ${RULES.length} rules, 0 violations`)
