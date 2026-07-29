# Annoyances

Every time a tool makes me do something stupid, one line goes here.

Rules, so this actually survives:

- **No filtering.** If it annoyed me, it goes in. Doesn't matter if it's small,
  if it's my fault, or if there's already a plugin for it.
- **No categories, no tags, no severity.** The moment logging becomes work, it
  stops happening.
- **Append only.** Never edit or delete an old line. Repeats are the whole point
  — a thing that shows up eleven times is the signal.
- **Write it while annoyed**, not later. Later never comes.

Format: date, then what happened. That's it.

```
2026-07-26  thing that annoyed me
```

## The instrument has to be able to return an answer I don't want

This log decides the premise at M5. So it has to be capable of selecting each
candidate. Left alone it isn't — and it fails in a way that's easy to miss.

**Premise B is collaboration friction. I work alone.** Eight weeks of solo
evenings generate zero collaboration entries, so B loses by never appearing on
the ballot. Fix: log the counterfactual. *Any time I'd have hit friction if a
second person were editing this file with me* — a merge I had to think about,
explaining a function over Discord, screen-sharing to point at a line, pasting
code into a chat — that's an entry. Mark it `[B?]`.

**Premise C is friction on slow hardware. I develop on a fast machine.** Same
failure. Fix: at least two full dogfood days on the oldest machine in the house,
and log everything, including things I'd normally shrug off. Mark it `[C?]`.

Without those two rules the log mechanically returns A or D — the two candidates
already judged weakest — and it looks like evidence.

**Recalled vs live.** Anything reconstructed after the fact (from VS Code
settings, keybindings, extensions, shell history, browser history) goes under a
separate `## Recalled` heading. Recall bias is real and it should stay visible
rather than blend into the live entries.

Pre-registering the guess so I can't rationalize toward it later: **gut says C,
constrained environments.** If the log says otherwise, the log wins.

---

2026-07-26  `git clone` inside `~/claven` gave me `~/claven/claven`. Every time.
2026-07-26  npm install picked vite 8, electron-vite caps at 7, plugin-react 6 requires 8. Three packages, no overlap. Had to bisect peer ranges by hand to find plugin-react 5.2 spans both.
2026-07-26  PowerShell `Set-Content -Encoding utf8` writes a BOM. It silently broke package.json for vite's config loader. Error pointed at index.css, four files away from the actual cause.
2026-07-26  No typescript-eslint release supports TypeScript 7 (latest 8.65.0, peer capped at <6.1.0, no v9). TS 7 GA'd 18 days ago. Wrote a 60-line boundary checker instead of downgrading or waiting.
2026-07-26  Commissioned ~40,000 words of premise research eight hours in, with four entries in this log. It concluded C is weak and B is the bet. **The pre-registration above is contaminated** — every `[B?]` entry from here is written by someone who already read the answer. Discount the M5 decision accordingly. Logging it rather than pretending otherwise.
2026-07-29  Bound the terminal to ctrl+backtick because every editor does. Backtick is one key on a US layout and a dead key or AltGr elsewhere, so the default costs me three keypresses and an American one. [C?]
