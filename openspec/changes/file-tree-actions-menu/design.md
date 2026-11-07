# Design

## Context

`ui/src/components/FileTree.tsx` renders each row as a flex line of a label button and up to six
hover-revealed icon buttons (`ROW_ACTION_CLASS`); folders carry ⌂ and +. File operations go out
through `useAgent` (`deleteFile`, `moveFile`, … in `ui/src/useAgent.ts`), each as one WebSocket
message with a `requestId`, and come back as one `file_operation_result`; the client holds a
single `fileOperation` state, which the tree also uses to disable rows while one is pending.
The server handlers (`handleDeleteFile`, `handleMoveFile` in `server/src/index.ts`) wrap the
confined helpers of `server/src/fileBrowser.ts` and broadcast `file_changed` per path.

Bytes reach the browser only through `GET /files/raw` (`server/src/index.ts`): token in the
query string or a Bearer header, host check, confined read through `readFileRaw`, and a 1 MB
ceiling outside images and PDFs — a preview route, not a download one. `rawFileUrl`
(`ui/src/util/workspacePath.ts`) builds its URL with the backend origin the embed needs.

Two menus already exist (`Header.tsx`, `ProjectMenu.tsx`) with `role="menu"` and
`useClickOutside`, but as dropdowns tied to their button, not as a reusable menu.

## Goals / Non-Goals

**Goals:**
- One menu component used by every tree row, keyboard-complete, positioned at the `⋯` or at the
  pointer, closed by outside click, Escape, scroll of the tree, or a context change.
- Selection kept in `FileTree` alone, so `Sidebar`/`App` keep passing the same props plus two
  batch callbacks.
- A download that works the same from the local app, a remote server, and the embed.

**Non-Goals:**
- ZIP64: archives past 65 535 entries or 4 GiB are refused, not split.
- Select-all, rubber-band selection, cut/paste.
- Undo of a delete, or a transactional batch.

## Decisions

**Menu: a small `RowMenu` component, not a library.** It renders in a portal-free absolutely
positioned layer inside the Files panel (the panel already scrolls and is the containing block),
flips above when it would overflow the bottom, and follows the WAI-ARIA menu pattern
(`role="menu"`, `menuitem`, roving focus, Home/End). A headless library (Radix, Floating UI)
would bring the positioning for free but adds a dependency for one surface, and the embed must
not leak portals into a host page — staying inside the panel avoids both. The items are built
by one pure function `rowActions(entry, context) → groups[]`, so ordering and the
"absent, not disabled" rule are unit-testable without rendering.

**Context menu**: `onContextMenu` on the row opens the same menu at the pointer and calls
`preventDefault`. Long press on touch relies on the browser firing `contextmenu` (Android Chrome
does; iOS Safari does not), which is why the `⋯` stays always visible on touch screens.

**Selection model**: `FileTree` holds `selected: Set<string>` and an `anchor`. The range is taken
over the *visible rows (files and folders) in display order*, computed from `tree` + the set of
open folders —
which means folder open state moves up from `TreeNode`'s local `useState` into `FileTree`
(a `Set<string>` of open paths). That lift is also what lets a collapsed folder's children be
excluded from a range and lets destination picking expand folders. A plain click opens the file
and makes it the sole selection and anchor, so a single-file selection never differs from
today's behaviour. The selection is pruned whenever the listing changes (paths no longer
listed) and cleared when the browser root changes. Before any request, the selection is
normalised by `outermost(paths)`: a path under another selected path is dropped, so a folder and
its own child are never both deleted, moved or archived.

**Folder lifecycle on the server.** The confined helpers of `fileBrowser.ts` gain a directory
branch rather than new siblings, so every rule (writable zone, confinement, no overwrite) is
checked in one place:
- *Rename/move*: files keep `linkThenUnlink`; a directory cannot be hard-linked, so it uses
  `fs.rename` after an `lstat` that finds no destination. The window between the two can only
  lose an **empty** directory created in it — `rename` fails with `ENOTEMPTY`/`EEXIST` on a
  non-empty one on POSIX, and on any existing one on Windows — which is accepted and stated.
  Moving into itself or a descendant is refused by comparing resolved paths, before `rename`
  would answer `EINVAL`.
- *Delete*: `fs.rm(path, { recursive: true })`, which removes links as links.
- *Protected roots*: the browser root and the resolved writable root are refused for rename, move
  and delete before any syscall; `isWithin` alone would accept the writable root, since it is
  within itself.

**One confined walk for archives and copies.** `walkConfined(root, entries)` yields every file and
directory under the given entries, using `lstat`; a symbolic link is followed only when its
resolution stays inside the browser root, otherwise it is left out and counted. Both the archive
and the folder copy consume it, so the two cannot disagree about what leaves the root.

**Folder copy**: `fs.mkdir` of the destination folder (fails on an existing one, which is the
no-overwrite claim), then the walk, creating directories and copying files with
`COPYFILE_EXCL`. A failure mid-way leaves the partial copy and reports it — the source is never
touched, so nothing is lost.

**Streaming zip.** A writer next to `office/src/zipWriter.ts` (same constants, same no-ZIP64
stance, same UTF-8 flag) but writing to a stream: per entry a local header with the
data-descriptor flag, the deflated body piped through `zlib.createDeflateRaw` while a CRC-32 is
computed, then the descriptor; the central directory at the end. The walk runs first to collect
entries and sizes, so the 65 535-entry and 4 GiB limits are checked — and refused with a JSON
error — before the response starts. The count of left-out entries goes in the archive comment
and in an `X-Pi-Outpost-Skipped` header the tree reads to say so. A new dependency (archiver,
yazl) was rejected for the reason the reader and writer give: the air-gapped deployments.

**Batch operations: new protocol messages, not N single messages.** `delete_files { paths }` and
`move_files { paths, destinationDirectory }`, answered by one
`file_batch_result { operation, done: [{ path, resultPath }], refused: [{ path, message }] }`.
Alternatives: send N `delete_file` messages from the client — it would fight the single
`fileOperation` state (each result would overwrite the last), produce N broadcasts and N re-lists,
and leave the partial-failure report to be stitched together on the client. The server handler
loops over the existing confined helpers sequentially (so the rules stay exactly those of the
single operations), collects outcomes, then broadcasts `file_changed` once per distinct parent
directory. `fileOperation` gains a batch variant so the tree disables mutations while it runs.

**Mixed selections**: a selection with any read-only entry offers no Delete/Move. Copying the
read-only part on drop, as single-entry drag does, would make one gesture do two different things
to one selection; the single-entry copy drag stays as it is.

**Download route: `GET /files/download?path=…[&path=…]`**, separate from `/files/raw`. Same host
check and token (query string: an `<a href download>` cannot send a header), confinement through
the existing resolver. One path naming a regular file: `createReadStream` as is. One directory,
or several paths: the streaming zip, named after the folder, or after the selection's common
parent folder (`files.zip` at the root). Headers: `Content-Type: application/octet-stream`
(`application/zip` for an archive), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`,
`Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<encoded>`.
Extending `/files/raw` with `?download=1` was rejected: its ceilings and inline image types are
what make it safe for `<img>`, and one route with two contracts is the kind that gets one of them
wrong. The client builds the URL with a `downloadUrl(paths)` next to `rawFileUrl` (same
origin/token/workspace handling). A single file is triggered with a temporary `<a download>`; an
archive is fetched first, so a refusal (too large) can be shown on the tree instead of a browser
download of an error body, then handed to the browser as a blob URL — streamed to disk where
the File System Access API is available, buffered otherwise.

**Destination picking**: a `picking: { paths } | null` state in `FileTree`. While set, a banner
above the listing names what is moved with a Cancel button, writable folder rows and the root
become click targets (reusing the drop-target styling), file rows are inert, Escape cancels.

**Keyboard on rows**: rows already are buttons; F2 and Delete are handled on the row's keydown
and routed through the same functions the menu calls, so the confirmation is identical.

## Risks / Trade-offs

- [An archive fetched into a blob is held in the browser's memory where the File System Access
  API is missing (Firefox, Safari)] → the 4 GiB limit bounds it; very large folders are better
  downloaded per subfolder, which the error message suggests.
- [A recursive delete of the wrong folder is not undoable] → the confirmation names the folder and
  says its content goes with it; the two roots are refused outright.
- [A folder copy that fails midway leaves a partial copy] → reported with what was copied; the
  source is never modified.
- [Lifting open-folder state out of `TreeNode` touches every row and the drop/creation code that
  calls `setOpen`] → do it as its own task with the existing `FileTree.test.tsx` green before
  any menu work.
- [The menu is cut off by the panel's overflow on a narrow sidebar] → flip and clamp inside the
  panel; covered by a Playwright check at the minimum sidebar width (224 px).
- [A query-string token appears in server logs and browser history] → same trade-off already made
  for `/files/raw` and the WebSocket; `no-store` and no logging of the query.
- [Batch on a large selection holds the socket handler] → sequential, but each step is one
  rename/unlink; the UI shows the pending state and the result.

## Migration Plan

No data migration. Old clients keep using the single-file messages, which stay. A new client
against an old server would send `delete_files`/`move_files` the server does not know; the
client and server ship from one package, so no compatibility shim is needed.
