---
title: How Claven treats your files
description: Encodings, line endings, atomic writes, and what happens when a file changes underneath you.
order: 3
---

An editor's one non-negotiable job is to give you back the file you opened, plus
exactly the changes you made and nothing else. Most of the work in this area is
invisible when it goes right, so here is what it does.

## Encodings

The byte-order mark is read and preserved. UTF-8, UTF-8 with BOM, UTF-16 LE and
UTF-16 BE are detected on open and written back the same way. UTF-8 with a BOM
is tracked separately from UTF-8 without one, because silently adding or
dropping a BOM changes the file and something downstream always cares — a shell
script stops running, a JSON parser stops parsing.

That is not hypothetical. This project lost an evening to PowerShell's
`Set-Content -Encoding utf8` writing a BOM into `package.json`, which broke
Vite's config loader and reported the error four files away from the cause.

## Line endings

Everything is LF inside the editor. What was on disk is recorded when the file
opens and restored when it saves, so editing one line in a CRLF file does not
turn the whole file into a diff.

If a file has **mixed** endings, the status bar says so on open, because saving
will make it consistent and that shows up as a large change you did not ask for.
The dominant ending wins. You can force a different one from the command
palette — `change line endings to lf`, `crlf` or `cr`.

## Trailing newlines

Whatever is in the buffer is what gets written, including at the end. If you add
a final newline it stays added; if you delete it, it stays deleted.

There was a version that forced the trailing newline back to whatever the file
had when it opened. It preserved nothing the buffer would not have preserved
anyway, and it made adding a final newline impossible — the edit went in and the
save quietly took it out again.

## Saving

Writes are atomic: a temporary file in the **same directory**, `fsync`, then
rename over the original. Same directory matters, because rename is only atomic
within a filesystem and a temp file in the OS temp directory would silently
degrade to copy-then-delete. The `fsync` matters because otherwise a crash can
leave the rename durable and the contents not, which is how you lose a file
while appearing to have saved it.

## When a file changes underneath you

Every save checks that the file's modification time still matches what it was
when you opened it. If something else has written to it — `git pull`, `git
checkout`, another editor — the save is refused rather than silently clobbering
the other change.

Refusing is only half of it. You then get a choice: **overwrite**, **discard
mine and reload**, or **cancel**. Cancel is the default, because the other two
each destroy a version of the file and neither is obviously right from where the
dialog is standing.

Claven does not yet watch files, so it finds out at save time rather than
telling you the moment it happens. That gap is known.

## Deleting

Delete moves to the OS trash. It never unlinks. An editor should not have an
unrecoverable delete.

Renaming refuses to overwrite an existing file — Windows would do it silently
otherwise — and a rename or move takes its open tabs with it rather than closing
them, so unsaved work survives.

## Limits

Files over **32 MB** are refused with a clear message rather than loaded into
the renderer's heap. Binary files are detected the way git does it, by looking
for a NUL byte in the first 8000 bytes, and refused. That sniff only runs after
a UTF-16 byte-order mark has been ruled out, because UTF-16 text is full of
legitimate NUL bytes and would otherwise look binary every time.

## The sandbox

Every filesystem operation resolves through the workspace root and refuses
anything that escapes it, symlinks included — a link inside your project
pointing at `/etc/shadow` is refused rather than followed. The renderer has no
Node access at all and can only reach an explicit allowlist of channels.

This is cheap to build now and impossible to retrofit later, and the list of
things that will eventually run inside the editor — language servers,
extensions, AI agents — is exactly the list of reasons to have done it early.
