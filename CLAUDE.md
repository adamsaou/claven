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

**Secrets never enter the repo.** `.env.example` holds fakes. Real coturn
configs, TURN credentials and keys stay out, permanently.

---

## Settled

| | |
|---|---|
| Name | Claven. Coined, no meaning. Naming is **closed** — don't reopen it. |
| Who it's for | **Me first.** Then semi-open-source and sold to developers. Dogfooding is the product strategy, not just a testing phase. |
| License (current) | Apache-2.0. See the licensing note below before assuming this is permanent. |
| Repo | Public from day one. Single repo, single package. |
| Contributions | **No outside code without a CLA.** This is now load-bearing — see below. |
| Shell | Electron. Cross-platform is a priority and Tauri means three engines, with the broken one (WebKitGTK) invisible from a Windows dev loop. Electron 43 drops 32-bit/armv7 on 2027-01-05; nothing here targets those. |
| Devlog | Ship the milestone, *then* film. Never build for the thumbnail. No schedule commitments. |
| UI layer | React + TypeScript + Vite + Tailwind. Cheap and swappable, not worth debating. |
| Syntax | tree-sitter |
| Language intel | LSP over JSON-RPC on stdio. v1 servers: `typescript-language-server`, `clangd`. Nothing else. |
| AI agents | ACP (Agent Client Protocol). Premise-neutral. |
| Terminal | xterm.js frontend |

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

## Open — do not write these up as decided

| | |
|---|---|
| **The product premise** | Four candidates (below). Decided at **M5**, by the annoyance log, not by argument. Pre-registered gut guess: **C**. |
| **App shell** | Electron vs Tauri v2. Under active decision. |
| **Editor core** | CodeMirror 6 vs a custom buffer + renderer. Under active decision. |
| **PTY layer** | Follows the shell decision. `node-pty` if Electron. |
| **Devlog start point** | M0 (the planning) or M1 (something that runs). |

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
