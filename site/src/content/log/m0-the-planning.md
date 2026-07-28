---
title: M0 — the planning
date: 2026-07-26
milestone: M0
# Drafted from CLAUDE.md and ANNOYANCES.md — the facts are sourced, the
# sentences are not yet mine. Flip this to false after a rewrite.
draft: true
summary: >-
  Four decisions before a line of product code: what the editor core is, who
  owns the copyright, what the premise might be, and how I will know if this
  is going to fail.
---

Claven is a code editor. I am building it in public, alone, on Windows, and it
is Apache-2.0 from the first commit. This is the log of why it looks the way it
does before it does very much at all.

Nothing here is a launch. There is no download and no release. What there is, on
day one, is a set of decisions that get expensive to reverse later, so I made
them first and wrote down the reasoning where I can be held to it.

## Not writing my own text buffer

The version of this project I wanted to build had a hand-written rope, custom
rendering, my own selection model. From scratch, properly.

I costed it instead. Choosing a custom buffer deletes CodeMirror's LSP client,
four maintained language grammars, search, autocomplete, and roughly five
hundred lines of already-working Unicode Bidi Algorithm — and replaces them with
somewhere between 150 and 300 hours of rendering, selection, undo, IME and
bidirectional text work, in exchange for reaching parity on day one. Against a
budget of 80 to 120 hours that is not a design choice. It is a decision not to
ship.

The base rates decided it. Edita — one person, same stack, custom text editing —
ran 21 months and never shipped LSP. Zed took roughly 45 people and five years,
shipped 1.0 without screen reader support, and still cannot render Arabic. And
VS Code measured their own buffer at under one percent of frame time, so there
is not even a performance argument to hide behind.

So: **CodeMirror 6**, and "from scratch" is retired. This is an editor built
*around* CodeMirror. The honest phrase is "built in public".

The rule that keeps it reversible is worth more than the decision itself. Every
reference to CodeMirror's view layer lives in exactly one adapter module, and an
import-boundary check fails the build if anything else reaches across.
Application code defines its own plain-data types; the adapter translates.
Without that rule the seam rots inside a month, because decorations and view
plugins live on the view side and every feature that draws wants to touch them.

The rope still gets written. As its own benchmarked repository, off the critical
path, where being slow costs nothing.

## The licensing thing nobody enjoys

I intend to sell this eventually. Two consequences pull in opposite directions
and both needed settling before the code was worth anything.

**Anything published under Apache-2.0 stays that way permanently.** It cannot be
un-published. Anyone holding that commit can fork it, close it, rebrand it and
sell it, owing me nothing but a copyright notice. That is genuinely fine today —
today this is a scaffold. It stops being fine at some point, so the license
question gets an answer before M5 rather than after.

**Future versions can be licensed differently, but only while I own all of it.**
The moment someone else's code lands without a contributor agreement, they hold
copyright on their part, and relicensing needs their permission. So: no outside
code merges without a signed CLA. Issues, bug reports and argument are welcome
and cost nothing.

Writing that down felt worse than deciding it. Turning away a good pull request
is a real cost, paid in a currency — goodwill — that a solo public project has
very little of.

## Four premises, and refusing to pick yet

The interesting question is not what to build. It is what a funded competitor
**cannot** build. Not "has not got to yet" — structurally cannot, because of
their business model or their customers. That is the only kind of gap that stays
open for one person.

- **A — comprehension-first.** AI that helps you *read* code: subsystem
  summaries, reading order, change-impact maps. Fails the test. Cursor has the
  retrieval infrastructure and three hundred people.
- **B — serverless, peer-to-peer collaboration.** Pair programming with no
  account, no company servers, nobody who can switch it off. Structurally
  uncopyable by anyone venture-funded.
- **C — constrained environments.** Old hardware, small memory, high latency,
  offline. Passes the test. Hard to make legible as a headline.
- **D — competitive programming as a first-class mode.** Problem URL in, sample
  tests pulled, one keystroke to compile and diff. Passes, cheap, low ceiling.
  Probably a feature rather than a premise.

I am not picking now, because I do not have the evidence and neither does
anybody else. M1 through M4 are identical under all four — about two months of
work that is not blocked on deciding anything. The decision happens at M5, from
a log of every time existing tooling makes me do something stupid.

## The instrument, and how I already damaged it

That log has an obvious failure mode. Premise B is collaboration friction and I
work alone, so eight weeks of solo evenings generate zero collaboration entries
and B loses by never appearing on the ballot. Premise C is friction on slow
hardware and I develop on a fast machine — same failure. Left alone, the log
mechanically returns A or D, the two candidates already judged weakest, and it
looks like evidence.

So there are two extra rules. Log the counterfactual: any time I would have hit
friction if a second person were editing with me, that is an entry. And at least
two full days of real work on the oldest laptop in the house, logging everything
I would normally shrug off.

Then I broke it myself.

Eight hours into the project, with four entries in the log, I commissioned about
forty thousand words of research on which premise to pick. It concluded that C
is weak, B is the bet, A should be dropped, D has a ceiling. My pre-registered
gut guess was C, written down precisely so the M5 decision could not be
rationalised toward it — and that only works if I have not read the answer key.

I have now read the answer key. Every entry I write from here is written by
someone who knows what the research concluded. That cost is paid and cannot be
refunded. What is still available is knowing it, writing it down, and discounting
the M5 decision by it. A compromised instrument that knows it is compromised is
still usable. One that has quietly forgotten is not.

## The tripwire

The failure mode for this project is not being out-competed. Cursor has never
heard of Claven. It is abandonment in October.

> If I have not opened Claven to do real work by 15 August, the problem is not
> the premise.

My available hours halve on 12 September. If Claven still is not worth opening
by then, I stop opening it, the log stops growing, M5 has no input, and the next
session is a chore with no reward attached. The loop breaks the moment I am no
longer the user.

Written down now, before the evidence arrives, because tripwires only work that
way.

## What is actually next

M1 is "it opens files" and is done: window, file tree, editor, tabs, save,
session restore. M2 is "does not look like a demo" — highlighting, theme, find.
M3 is LSP and is the hard one.

Nothing on that list is blocked on the premise, which is the point.
