---
title: Getting started
description: There are no releases yet. Build it from source.
order: 1
---

There are no downloads. Claven has not shipped a release and will not until it
is worth installing — the roadmap says where that line is. Until then, building
from source is the only way in, and it takes about two minutes.

## What you need

- **Node 20 or newer.** The app declares `>=20`; the site is a separate package
  and wants 22.12 or newer, because Astro does.
- **Git.**
- Nothing else. No compiler, no Python, no build tools. There are no native
  modules in the tree yet — `node-pty` arrives at M4 and will change this.

## Build and run

```
git clone https://github.com/adamsaou/claven.git
cd claven
npm install
npm run dev
```

`npm run dev` starts electron-vite with hot reload for the renderer. Changes to
the main process restart the app; changes to the UI do not.

## The other scripts

| | |
|---|---|
| `npm run build` | Typecheck, then bundle main, preload and renderer into `out/`. |
| `npm run typecheck` | Both projects — node and web — with no emit. |
| `npm run lint` | The import-boundary checker. Not ESLint; see below. |
| `npm run smoke` | Launches the real app headless and exercises the IPC contract and the file layer end to end. |
| `npm run drive` | Launches the real window and drives it over the DevTools protocol — typing, clicking tabs, undo. |
| `npm run start` | Preview a production build. |

`npm run lint` is a hand-written checker rather than ESLint because no
typescript-eslint release supports TypeScript 7 yet. That is a real gap, written
down rather than papered over, and it goes away when the peer range opens.

## Platform notes

Windows and Linux are first-class and both get used. **macOS is portable by
construction but untested** — the code has no Windows-only assumptions and the
darwin branches are written, but nobody has run, signed or notarised a build,
because there is no Mac. Treat it as unproven rather than supported. If you have
one and it breaks, an issue with the output is genuinely useful.
