## Context

See `proposal.md` — Why. What shapes the approach:

- **`write_file` refuses a missing path on purpose.** `writeFileFromBrowser` stats the target and
  answers `conflict` when it is gone: that is how a concurrent move is caught rather than
  papered over. Creation cannot ride on that message without turning its guard into a flag.
- **Confinement already exists and must not be re-implemented.** `resolveConfined` (symlink-safe,
  root-relative) plus the writable-zone check are the two gates every browser write passes. A new
  operation reuses both, or it is a new hole.
- **The tree already refreshes itself.** The server broadcasts `file_changed`; `useAgent` re-lists
  the parent directory of the changed path when that directory is open, refetches an open viewer,
  and refreshes Git status. Creation needs no new refresh mechanism — only the broadcast.
- **The tree already has a row control convention.** The `@` reference button appears on hover,
  stays visible on touch (`[@media(hover:hover)]:opacity-0`), and sits inside a `group` row. A
  second control follows it rather than inventing a placement.
- **The tree already knows what is writable.** `isReadOnly(fullPath, writableRoot)` dims entries
  outside the writable zone; the creation control asks the same function.

## Goals / Non-Goals

**Goals:**
- One server-side creation path per kind (file, directory), sharing every check with the write path.
- A name is typed where the file will land, so the destination is never ambiguous.
- A refusal is shown where the name was typed, with the typed name intact.

**Non-Goals:**
- Rename, delete, move. They act on files an agent may be mid-read of, and they need an answer for
  the open viewer and the running turn — a separate change.
- Creating parent directories implicitly (`mkdir -p`). One control, one directory.
- Templates, scaffolds, or seeded content. An empty file is the primitive; the agent writes content.
- Drag-and-drop upload into the tree.

## Decisions

### D1 — Two new messages, not a flag on `write_file`

`create_file` and `create_directory` join the client protocol, answered by the existing
`file_written` / `file_browser_error` pair.

*Alternative — `write_file` with `create: true`.* One message fewer. Rejected: the mtime-conflict
guard exists precisely because a missing file is suspicious, and a boolean that suspends it is a
guard with an off switch. Two intents, two messages, and `write_file` keeps refusing what it
refuses today.

### D2 — Creation reuses the write path's checks, in the same order

`createFileFromBrowser(root, writableRel, relPath)` in `fileBrowser.ts`, beside
`writeFileFromBrowser`, running the same sequence: read-only sandbox → `resolveConfined` →
writable-zone containment → existence. Only the tail differs: where the write path demands the file
exist, creation demands it does not.

`fs.writeFile(resolved, "", { flag: "wx" })` and `fs.mkdir(resolved)` (no `recursive`) do the
existence check *and* the creation in one syscall — a separate `stat` first would be a
time-of-check/time-of-use gap. The `EEXIST` becomes the `conflict` error; `ENOENT` (missing parent)
becomes `not-found`.

### D3 — A name is a name

The final segment is validated on both sides: no `/` or `\`, not `.` or `..`, not empty or
whitespace-only, and no NUL. The client validation is for the message shown while typing; the
server validation is the one that counts, and it runs before anything touches the filesystem.

This is belt and braces over `resolveConfined`, which already refuses an escape — but a name
carrying a separator is a mistake worth naming precisely ("that is a path, not a name") rather than
a generic confinement refusal.

### D4 — The input lives in the tree

Activating `+` on a directory row inserts an input row as that directory's first child, at its
indentation. Enter confirms, Escape cancels, blur cancels. A single control creates both kinds: a
name ending in `/` is a directory, anything else a file — one keystroke rather than a second
button, and it matches how the same intent is expressed on a command line.

The trailing slash is not discoverable on its own, so the input's placeholder says it:
`name, or name/ for a folder`.

*Alternative — a modal dialog.* Rejected: the destination would have to be restated in the dialog,
and the tree is already showing it. *Alternative — a second `+📁` control.* Rejected: two controls
on every writable row, in a tree where one control already had to be hidden until hover.

### D5 — What happens next differs by kind

A created file opens in the viewer in edit mode: the client already has the path, size and mtime
from the answer, which is exactly what the editor needs to save without a read round trip. A
created directory expands instead — there is nothing to open, and the next action is usually to
create something inside it.

### D6 — Optimism is not worth it here

The tree waits for the server's answer and the `file_changed` broadcast rather than inserting the
row immediately. Creation is a single local `write`; the round trip is a few milliseconds, and an
optimistic row would need its own removal path for every refusal.

### D7 — Success is a signal, not an inference

*Added after the first manual test, which found the bug.* The input first closed itself by watching
the parent listing for the typed name. That reads as success — and it is exactly what a **refused
duplicate** looks like: the name is in the listing precisely because something is already there. So
retyping an existing name silently dismissed the input and showed no refusal at all.

The client state now carries `created`, the path the last creation actually produced, set from the
server's own answer (`file_written` or a directory listing under a `create:` request id) and
cleared when the next attempt starts. The input closes on that and nothing else.

The general shape of the mistake is worth naming: *inferring an outcome from a side effect that the
failure case also produces.* A regression test pins it — refused duplicate, listing unchanged,
input and message still on screen.

## Risks / Trade-offs

- **A user-typed name becomes a path segment** → validated on both sides (D3) and confined by
  `resolveConfined` regardless; the server never trusts the client's validation.
- **Case-insensitive filesystems** (macOS default): creating `Readme.md` beside `README.md` fails
  with `EEXIST` even though the tree shows no such name → the conflict message names the existing
  entry rather than claiming the name is free.
- **`file_changed` carries a path, and the client refreshes only if that path's parent is open** →
  true already; a directory created in a collapsed part of the tree simply appears when it is
  expanded.
- **A creation control on every writable directory row** adds a second hover affordance to a tree
  that already hides one → both use the same reveal rule, and the row stays a single flex line.
- **Newly created files are untracked**, so the Git badge machinery marks them immediately. Nothing
  to do, but it is the visible difference between a file created here and one the agent wrote.

## Migration Plan

Additive: two new client messages, two new server functions, one new tree control. Older clients
never send the messages; a server without them answers an unknown message the way it does today.
Rolling back is removing the handlers and the control.
