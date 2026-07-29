---
title: "M3: it reads now"
date: 2026-07-29
milestone: M3
summary: >-
  Claven understands TypeScript. Two things about getting there that the
  docs would not have told me.
---

Claven could colour code. It couldn't read it. Those are different jobs, and
the second one needs a separate program, a language server, that loads your
project and knows what things actually mean.

That runs now. A TypeScript error underlines while you type, before you save.
TypeScript only. The other nine languages still just get colour.

Two things went wrong on the way, both worth writing down.

My notes said use `typescript-language-server`. It can't work here. It drives
`tsserver.js`, and TypeScript 7 is the Go rewrite, so there is no `tsserver.js`
anymore. It exits at startup saying it can't find a valid TypeScript
installation, which is true.

The fix would have been installing TypeScript 5 next to 7 just to feed the
wrapper. Two compilers, and squiggles computed by a different one than my build
uses. No thanks. TypeScript 7 ships its own server in the binary, so I used
that instead. It agrees with `npm run typecheck` by construction.

Then I connected it and got nothing.

Server started. Initialised. Answered. No underlines. Turns out the client
library waits for the server to announce problems, and TypeScript 7 doesn't
announce. It expects to be asked. The push fired once, empty. Asking directly
returned the actual error immediately.

That's the bit I want to remember. Not a crash. Not an error in a log. A
connection that looked completely healthy and silently reported nothing. If I'd
wired it up and glanced at a file that happened to be correct, I'd have called
it done.

What's actually verified: diagnostics. There's a test that types an error into
a buffer, never saves, and waits for the underline.

Completion, hover, go-to-definition, rename all came bundled with the
connection. They should work. I haven't driven them, so they're claims.

Next language is cheap: install a server, add a line for its file extensions.
The pipe is the part that took the week.
