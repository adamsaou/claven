# Claven

An open-source code editor, built from scratch, in public. Apache-2.0.
`claven.dev` · `github.com/adamsaou/claven`

Solo project. Built on Windows, but **cross-platform support is a priority, not a
later problem** — Windows, macOS and Linux are all first-class targets from M1.

---

## How to work in this repo

**Mark open questions as open.** The single most useful thing you can do here is
refuse to fill a gap with a plausible answer. A previous assistant wrote an
unchosen product premise into this file as if it were settled, and labelled a
list of suggestions "Locked stack." Both were inferences presented as decisions.
If something below isn't in the Settled table, it isn't settled — say so rather
than smoothing over it.

**Don't recommend things you haven't checked.** Same session burned real time on
names that died on first inspection. Query the API, read the repo, run the
command.

**Voice.** Direct and short. No marketing register, no over-polished AI prose.
Docs and commit messages should sound like a person wrote them.

**No em dashes.** Anywhere: docs, site copy, the log, commit messages, code
comments. Use a full stop, a comma, a colon or brackets instead. Two of them in
a paragraph is the clearest tell that a machine wrote it, and this project is
public and written in my name.

**The devlog is drafted in conversation, never written straight to the site.**
Settled 2026-07-29. An assistant produces the draft in chat, I rewrite it, and
only then does it land in `site/src/content/log/`. Docs, roadmap and chrome can
be written and shipped directly — the log is the exception, because it is a
personal build log published under my name on a project I intend to sell, and
prose I did not write being attributed to me is not fixed by the facts being
correct. Anything that reaches the directory before my pass carries
`draft: true`, which keeps it out of the index, the landing page and the feed.

**`ANNOYANCES.md` is mine. Never write to it.** Settled 2026-07-31. An assistant
may read it and reason about it, and must not add, edit or reword a line. The
log decides the premise at M5, its rules say "write it while annoyed", and an
entry phrased by a machine is evidence about the machine's phrasing rather than
about the annoyance. Same reasoning as the devlog rule above, and a stronger
case: the devlog is only published under my name, whereas this is the
instrument. If I say something in conversation that belongs in it, say so and
leave it to me.

**Secrets never enter the repo.** `.env.example` holds fakes. Real coturn
configs, TURN credentials and keys stay out, permanently.

---

## Settled

| | |
|---|---|
| Name | Claven. Coined, no meaning. Naming is **closed** — don't reopen it. |
| Who it's for | **Me first.** Then semi-open-source and sold to developers. Dogfooding is the product strategy, not just a testing phase. |
| License (current) | Apache-2.0. See the licensing note below before assuming this is permanent. |
| Repo | Public from day one. Single repo, **two packages**: the app at the root and the site in `site/`. Amended 2026-07-27 — it was "single package". Deliberately *not* an npm workspace: `site/` has its own `package.json` and lockfile and is installed and built on its own, so the app's dependency tree is untouched. That was the point of the original rule; keeping the site's docs and devlog in the same commit as the code they describe is what it buys. |
| Contributions | **No outside code without a CLA.** This is now load-bearing — see below. |
| Shell | Electron. Cross-platform is a priority and Tauri means three engines, with the broken one (WebKitGTK) invisible from a Windows dev loop. Electron 43 drops 32-bit/armv7 on 2027-01-05; nothing here targets those. |
| Devlog | Ship the milestone, *then* film. Never build for the thumbnail. No schedule commitments. **Start point: M0**, the planning — closed 2026-07-27. The written log lives at `site/src/content/log/`; the video question is untouched by this. |
| UI layer | React + TypeScript + Vite + Tailwind. Cheap and swappable, not worth debating. |
| **Editor core** | **CodeMirror 6**, behind a single adapter module. Reasoning below. Closed 2026-07-26. |
| Syntax | **Lezer**, via `@codemirror/lang-javascript` (TS/TSX), `lang-cpp`, `lang-java`. Supersedes the earlier "tree-sitter" row — with CM6 those grammars ship maintained, and bolting tree-sitter on top is 15+ hours for no visible difference. |
| Language intel | LSP over JSON-RPC on stdio, via `@codemirror/lsp-client`. **One server before September: TypeScript's own**, `tsc --lsp --stdio`. Amended 2026-07-29 — it said `typescript-language-server`, which cannot work here: that wrapper drives `tsserver.js`, and TS 7 is the Go rewrite whose `lib/` has no such file. It exits during `initialize`. See the LSP note below. clangd needs `compile_commands.json` on Windows/MinGW or it guesses include paths — a multi-evening hole attached to a workload that compiles fine without it. |
| AI agents | ACP (Agent Client Protocol). Premise-neutral. Season two — M6 at the earliest. |
| Terminal | xterm.js + `node-pty`. |
| Workbench layout | **A split tree, and any pane holds anything.** Closed 2026-07-31, against two log entries rather than an argument: VS Code's layout is cryptic, and CLI AI tools look wrong in a terminal. Slice one ships terminals anywhere plus a single editor pane; a second editor pane is deferred because tabs are still one list in `App`. See the note below on why nothing stateful is rendered inside the tree. |
| Platforms | Windows and Linux first-class. **macOS is portable-by-construction but untested until I own a Mac** — I cannot run, sign or notarise it, so claiming it as first-class was an unfunded mandate. |

### Editor core — why CodeMirror 6

Choosing a custom buffer deletes `@codemirror/lsp-client` (completion, hover,
diagnostics, go-to-definition, find-references, rename, signature help behind a
three-method Transport), four maintained language grammars, `@codemirror/search`,
`@codemirror/autocomplete`, and ~500 lines of already-written Unicode Bidi
Algorithm — and replaces them with 150–300 hours of rendering, selection, undo,
IME and bidi work before reaching parity on day one. Against an 80–120 hour
budget that is not a design choice, it is a decision not to ship.

The base rates: Edita — solo, same stack, custom text editing — hit 21 months and
never shipped LSP. Zed took ~45 people and five years and shipped 1.0 without
screen readers, still unable to render Arabic. And VS Code measured their own
buffer at under 1% of frame time, so there is no performance argument either.

**The rule that keeps this reversible:** every `EditorView` reference lives in one
adapter module, enforced by `eslint no-restricted-imports`. App code defines its
own plain-data decoration type and the adapter translates. Without that the seam
decays within a month of M3.

**"From scratch" is retired.** With CM6 this is an editor built *around*
CodeMirror. The honest description is "built in public." The rope still gets
written — as its own benchmarked repo, off the critical path.

### The language server, and the two surprises in it

Both of these were measured against the real server, not read about.

**`typescript-language-server` is a dead end on TypeScript 7.** It drives
`tsserver.js`. TS 7 is the Go rewrite and ships `tsc.js` and `getExePath.js` and
nothing else, so the wrapper exits during `initialize` with "Could not find a
valid TypeScript installation". Using it would mean installing TypeScript 5
alongside 7 purely to feed it — two compilers on disk, and an editor whose
squiggles can disagree with what `npm run typecheck` says. TypeScript 7 instead
ships its own LSP server inside the native binary, which is the one thing
guaranteed to agree with the build. `--stdio` is required; without it the server
refuses with "only stdio is supported".

**TypeScript 7 does not really push diagnostics.** It advertises a
`diagnosticProvider` and expects to be asked, via `textDocument/diagnostic`.
`@codemirror/lsp-client` 6.2.5 only listens for `publishDiagnostics`. Measured:
the push fired once with an empty list while the pull returned the actual error.
So diagnostics are pulled by a `linter` source in the adapter, and everything
else — completion, hover, go-to-definition, rename — comes from
`languageServerSupport` unchanged.

Related: the client has no hook for server-to-client *requests*, so
`client/registerCapability` is answered inside the Transport. Declaring
`dynamicRegistration: false` is the polite fix and was tried first; TypeScript
registers regardless.

### The split layout, and the rule that makes it possible

**Nothing stateful is rendered inside the layout tree.** React unmounts a
component when it moves to a different parent, and keys do not help: a key only
preserves an instance among its own siblings. So a terminal rendered inside its
pane is destroyed by every drag, and destroying a `TerminalView` kills its
shell. The pane arrives where you dropped it, looking healthy, with a fresh
prompt and your build gone.

So `Workbench` renders chrome and empty measured boxes, and `SurfaceLayer`
paints the editor and every terminal over the top of them, absolutely
positioned, in one flat list. Moving a terminal across the window changes four
numbers on a style attribute and touches no component identity. The same
argument covers the editor, which would otherwise lose its undo history and
every cached scroll position on a split.

The list must also be **ordered by creation, never by position in the tree**.
Ordering it by the layout reintroduces the same bug in a quieter form: React
reorders keyed children, which is a DOM move, and moving an xterm detaches and
reattaches it.

**Two things were measured rather than assumed.** A shell started into a pane
that has not been laid out yet fits to zero and prints its first prompt one
column wide, which no later resize repairs, so `TerminalView` waits for a real
size before spawning. And xterm calls `stopPropagation` on every control
character it handles, so `Ctrl+J` reached the shell as a line feed and the
shortcut that hides the terminal did nothing from inside a terminal. Shortcuts
that only move panels around are now passed through; `Ctrl+C`, `Ctrl+W` and
`Ctrl+S` stay the shell's, because an editor that ate an interrupt would be
worse than one with no shortcuts.

**The layout lives in the session file, not localStorage.** It started in
localStorage, on the reasoning that it is renderer-only chrome. The drive suite
falsified that: localStorage is flushed to disk on Chromium's own schedule, so
after a `SIGKILL` the window came back with its unsaved edits intact and its
panes gone.

### Licensing — read before touching the license or accepting a PR

The plan is to sell this eventually. Two things follow, and they pull opposite ways.

**Anything already published under Apache-2.0 stays that way forever.** It cannot
be un-published. Anyone holding that commit can fork it, close it, rebrand it and
sell it, owing nothing but a copyright notice. That's fine today — it's a
scaffold. It stops being fine once the codebase is worth something, so the
license question gets answered **before M5**, not after.

**Future versions can be licensed differently, but only while I own all of it.**
The moment someone else's code lands without a CLA, they hold copyright on their
part and relicensing needs their permission. So: no outside code merges without a
signed CLA. Issues, bug reports and discussion are welcome and cost nothing.

Realistic models when it's time: open core (core stays open, paid features in a
separate private repo), or source-available (BSL/FSL-style — readable, but
commercial use restricted, and it stops being open source). Not decided.

**Payment rail:** solved in principle — a US-based co-founder can hold the
account, since Stripe does not operate as a merchant in Morocco and Polar's rail
is 18+. Two conditions. Copyright stays 100% mine unless a written agreement says
otherwise; payment processing is not ownership and the two must not blur. And no
paid tier, licence key or payment integration until there are 500+ weekly active
users who are not me — licence-key support at $29/seat is the most
time-expensive revenue in software and would eat exactly the evenings I don't
have. The rail being solved means I can stop thinking about it, not start using it.

## Open — do not write these up as decided

| | |
|---|---|
| **The product premise** | Four candidates (below). Decided at **M5**, by the annoyance log, not by argument. Pre-registered gut guess: **C**. See the contamination note. |
| **License model** | Open core vs source-available. Answer before M5. |
| **Written devlog voice** | The M0 entry on the site is a draft written from this file and `ANNOYANCES.md`. It is in first person and it is not yet in your words. Rewrite before it counts as published. |

### Tripwire

Written down now, before the evidence arrives, because tripwires only work that way:

> **If I have not opened Claven to do real work by 15 August, the problem is not
> the premise.**

The failure mode for this project is not being out-competed. Cursor has never
heard of Claven. It is abandonment in October — hours halve on 12 September, and
if Claven still isn't worth opening by then, I stop opening it, the log stops
growing, M5 has no input, and the next session is a chore with no reward
attached. **The loop breaks the moment I am no longer the user.**

### The pre-registration is contaminated — discount M5 accordingly

On 2026-07-26, eight hours into the project and with four entries in the log, I
commissioned ~40,000 words of research on which premise to pick. It concluded
that C is weak, B is the bet, A should be dropped, D has a ceiling.

`ANNOYANCES.md` pre-registers "gut says C" precisely so the M5 decision cannot be
rationalised toward it. **That only works if you haven't read the answer key.**
Every `[B?]` entry written from here is authored by someone who has read a report
saying B is the bet. That cost is already paid and cannot be undone.

What can still be done: know it, write it down, and discount the M5 decision by
it. A compromised instrument that knows it is compromised is still usable. One
that has quietly forgotten is not.

### The premise candidates

The test: *what can a funded competitor not or will not build?* Not "hasn't got
to yet" — structurally cannot, because of their business model or customer base.
That's the only kind of gap that stays open for one person.

- **A — Comprehension-first.** AI that helps you *read*: subsystem summaries,
  reading order, change-impact maps. Best research support, but fails the test —
  Cursor has the retrieval infra and 300 people.
- **B — Serverless / P2P collaboration.** Pair programming with no account, no
  company servers, nobody who can switch it off. Structurally uncopyable by
  anyone venture-funded. Sits on WebRTC/coturn infrastructure that already runs.
- **C — Constrained environments.** Old hardware, small RAM, high latency,
  offline. Passes the test. Hard to make legible as a headline. *Current gut.*
- **D — Competitive programming as a first-class mode.** Problem URL in, sample
  tests pulled, one keystroke to compile and diff. Passes the test, cheap to
  build, low ceiling. Probably a feature, not a premise.

B and C combine into "an editor that doesn't need a company to exist." A and D
can live inside any premise as features.

**How it gets decided:** `ANNOYANCES.md`. One line every time existing tooling
forces something stupid. No filtering. At M5 the repeats identify themselves.

**Second signal, because this gets sold.** The log measures what annoys *me*.
What other developers would *pay* to fix is a different list, and M5 needs both.
Before M5, get real answers from actual developers — the FTC team is the obvious
first source, and their season starts in September, right as M5 lands.

Worth being honest about the tension this creates: **C is the hardest of the four
to sell.** Developers with money have fast laptops. It is a real differentiator
and the one most likely to stay unpaid. B is the opposite — teams routinely pay
for collaboration. That is not a reason to drop C. It is a reason not to let the
log be the only input.

Hardware for dogfooding C: two old Xubuntu laptops. At least two full dogfood
days happen on those, per the rules in `ANNOYANCES.md`.

---

## Roadmap

M1–M4 are identical under all four premises — about two months of work that
isn't blocked on deciding anything.

1. **M1 — It opens files.** Window, file tree, editor, Ctrl+S, tabs.
   *Done when* a real file edit survives on disk.
2. **M2 — Doesn't look like a demo.** tree-sitter highlighting (TS/TSX + C++),
   theme, font, find-in-file.
3. **M3 — LSP.** The hard one, weeks. Spawn servers, JSON-RPC framing,
   diagnostics, completion, hover, go-to-definition.
   *Done when* a TypeScript error squiggles without saving.
4. **M4 — Terminal.** PTY + xterm.js.
5. **M5 — Dogfood and decide.** One week as the only editor. Read the annoyance
   log. Rewrite the premise section of this file.
6. **M6 — ACP client.** Premise-neutral.
7. **M7 — The premise**, whatever it turned out to be.

Before building on the shell's IPC, prove the typed contract end-to-end on a
single channel.
