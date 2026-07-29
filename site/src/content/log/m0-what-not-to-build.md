---
title: "M0: deciding what not to build"
date: 2026-07-26
milestone: M0
summary: >-
  Four decisions before any product code. What the editor core is, who owns
  the copyright, and how I will know if this is going to fail.
---

Claven is a code editor. Open source, built in public, alone, on Windows.

Before writing much of it I had to settle some things that get expensive to
reverse. Here they are.

**The buffer.** I wanted to write my own. Rope, custom rendering, my own
selection model. From scratch, properly.

Then I costed it. Going custom deletes CodeMirror's LSP client, four maintained
grammars, search, autocomplete, and about five hundred lines of working Unicode
bidi handling. It replaces them with somewhere between 150 and 300 hours of
rendering, selection, undo, IME and right-to-left work, in exchange for
reaching parity on day one.

I had 80 to 120 hours. That isn't a design choice, it's a decision not to ship.

The base rates settled it. Edita: one person, same stack, custom text editing,
21 months, never shipped LSP. Zed: about 45 people, five years, shipped 1.0
without screen reader support and still can't render Arabic. And VS Code
measured their own buffer at under one percent of frame time, so there isn't a
performance argument either.

So: CodeMirror 6, and "from scratch" is retired. This is an editor built around
CodeMirror. The honest phrase is built in public.

One rule keeps it reversible. Every reference to CodeMirror's view layer lives
in a single adapter module, and a check fails the build if anything else
reaches across. Without that the seam rots in a month.

**The licence.** I intend to sell this eventually, and two facts pull against
each other.

Anything published under Apache-2.0 stays that way permanently. Anyone holding
that commit can fork it, close it, rebrand it, sell it, and owe me a copyright
notice. Fine while this is a scaffold. It stops being fine later, so the licence
question gets answered before M5.

Future versions can be licensed differently, but only while I own all of it.
The moment someone else's code lands without a contributor agreement, they hold
copyright on their part. So no outside code merges without a CLA. Issues and
argument are welcome and cost nothing.

Writing that down felt worse than deciding it.

**The premise.** I don't know what Claven is for yet. Four candidates, and the
test is what a funded competitor structurally cannot build, not what they
haven't got around to.

I'm not picking now. M1 through M4 are identical under all four, about two
months of work that isn't blocked on deciding anything. The decision happens at
M5, from a log of every time existing tooling makes me do something stupid.

Then I broke that log before it started.

Eight hours in, with four entries in it, I commissioned about forty thousand
words of research on which premise to pick. It came back with an answer. My
pre-registered guess was written down precisely so I couldn't rationalise
toward it later, and that only works if I haven't read the answer key.

I've read the answer key. Every entry from here is written by someone who knows
what the research concluded. That cost is paid. All I can do is know it and
discount M5 accordingly.

**The tripwire.** Written now, before the evidence arrives, because that's the
only time it works.

If I haven't opened Claven to do real work by 15 August, the problem is not the
premise.

The failure mode here isn't being out-competed. Cursor has never heard of
Claven. It's abandonment in October. My hours halve on 12 September, and if it
still isn't worth opening by then, I stop opening it, the log stops growing,
and M5 has no input.
