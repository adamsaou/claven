---
title: Architecture
description: Three processes, one typed contract, and the seam that keeps the editor core replaceable.
order: 4
---

Claven is an Electron app: a main process with filesystem and OS access, a
renderer with none, and a preload script that connects them through one narrow
door.

## The processes

**Main** (`src/main`) owns everything privileged — the window, dialogs, the
filesystem, and eventually language servers and PTYs.

**Preload** (`src/preload`) exposes exactly two functions to the renderer:
`invoke` and `subscribe`. `ipcRenderer` itself is never handed over. Giving the
renderer a general-purpose `send` would make the allowlist decorative.

**Renderer** (`src/renderer`) is React and TypeScript with no Node access at
all: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Those
are Electron's defaults on current versions, and they are set explicitly anyway
so that a future refactor flipping one is something a reviewer can object to.

## The IPC contract

`src/shared/ipc.ts` is the single source of truth for everything that crosses
between processes. Every channel declares its request and response types, and
three things follow automatically:

- Adding a channel without adding it to the runtime allowlist is a **compile
  error** that names the missing channel — not a call the preload silently
  refuses the first time a user clicks the thing.
- Registering no handler for a declared channel **fails at startup**, rather
  than leaving a renderer call hanging forever with no error.
- Errors cross as data, never as thrown `Error`s. Electron serialises a thrown
  error into a string with the main-process stack glued on the front, which the
  renderer cannot branch on. Everything returns an explicit result envelope
  instead.

Pushed events — main to renderer, unsolicited — have their own table. That was
built before anything needed it, because almost everything still to come is
push rather than request/response: LSP diagnostics, terminal output, file-watch
events, and eventually peer updates.

## The editor core

The editor is **CodeMirror 6**. Choosing a custom text buffer instead would have
deleted the LSP client, four maintained grammars, search, autocomplete and a
working implementation of the Unicode Bidi Algorithm, and replaced them with
somewhere north of 150 hours of rendering, selection, undo, IME and
bidirectional-text work before reaching parity on day one.

The rule that keeps that reversible: **every reference to CodeMirror's view
layer lives in one adapter module**, and an import-boundary check enforces it.
Application code defines its own plain-data types and the adapter translates.
Without that rule the seam decays within a month, because decorations, widgets
and view plugins all live on the view side and every feature that draws would
reach across.

So "built from scratch" is retired. This is an editor built *around* CodeMirror,
and the honest description is "built in public".

## Right-to-left text

Per-line base direction is on. Claven renders Arabic and Hebrew correctly
because CodeMirror already ships the Unicode Bidi Algorithm and this turns it on
per line, rather than forcing one direction on the whole document.

For scale: Zed's RTL tracking issue is 2 of 52 subtasks after 14 months, and VS
Code's has been open since 2016. This is not a boast about effort — it is the
single clearest case of what picking a mature core buys you for free.

## Testing

Two harnesses, both driving the real application rather than mocks.

`npm run smoke` launches the app headless and runs every assertion through the
actual renderer → preload → main path, so it tests the bridge rather than
pretending to. It covers the contract, the sandbox, encodings and line endings,
and byte-for-byte round trips of every awkward fixture in the repo.

`npm run drive` opens a real window and drives it over the DevTools protocol —
typing, clicking tabs, pressing `Ctrl+Z`. It exists because the smoke run cannot
see the renderer, so UI regressions were being found by hand, which means found
late.
