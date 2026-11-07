# Proposal

## Why

A file row in the Files tree now carries up to six controls (↗ open with app, ⌂ show in file
manager, ✎ rename, × delete, @ reference, the git badge), and a folder row two (⌂, +). Hover-revealed
icons with no labels are hard to tell apart, and there is no room left for the action a remote
deployment most needs: getting a file from the server onto the machine in front of the user. Acting
on several files means repeating the same click once per file.

## What Changes

- Each file and folder row gets one **actions menu**, opened by a `⋯` control (revealed on hover,
  always present on touch screens) or by the row's context menu (right-click, or long press where
  the browser fires one). Its items are labelled and grouped in a fixed order:
  - file: **Open**, **Show diff** (when the file has changes), **Open with associated app**,
    **Show in file manager** · **Reference in prompt** / **Remove from prompt**, **Download** ·
    **Rename…**, **Move to…** · **Delete…**
  - folder, at parity: **New file or folder…**, **Show in file manager** · **Reference in
    prompt**, **Download as .zip** · **Rename…**, **Move to…** · **Delete…**
  - an item the row cannot take (read-only entry, no handler wired) is absent, not disabled.
- Besides the `⋯`, the row keeps the **git badge** (still opens the diff) and the **@** reference
  toggle (on hover, lit while referenced). The ↗ ⌂ ✎ × + icons leave the row for the menu, where
  each item carries its action's symbol.
- **Folders get every lifecycle operation files have**: rename, delete (with everything inside,
  said in the confirmation), move (never into itself, never replacing an existing folder), copy of
  a read-only folder by drag, reference in prompt. The browser root and the writable root itself
  cannot be renamed, moved or deleted.
- **Download**: a new authenticated, confined server route serves a file as an attachment under its
  own name, a folder as a `.zip`, and several selected entries as one `.zip` — streamed, without
  the 1 MB preview ceiling of `/files/raw`. An archive past 65 535 entries or 4 GiB is refused
  before its first byte; entries that resolve outside the browser root are left out and counted.
- **Multi-selection of files and folders**: Shift-click selects a range of visible rows,
  Ctrl/Cmd-click toggles one, Escape clears; an entry inside a selected folder is covered by it. On
  a selection the menu offers **Delete…** (one confirmation naming the count), **Move to…**,
  **Download** (one archive) and **Reference in prompt**; dragging a selected row onto a folder
  moves the whole selection.
- **Move to…** puts the tree in a destination-picking mode: writable folders become targets, a
  click moves, Escape cancels.
- Keyboard: the menu is a proper menu (arrow keys, Enter, Escape, focus returns to the row); F2
  renames and Delete deletes from a focused row or selection.
- Several entries are deleted or moved in **one request**, which reports per entry what succeeded
  and what was refused; nothing is rolled back.

## Capabilities

### New Capabilities

None — the behaviour belongs to the existing Files tree, file-browser and attachment capabilities.

### Modified Capabilities

- `components`: `FileTree lifecycle controls` is rewritten around the actions menu; new
  requirements for the menu, multi-selection and the destination-picking mode.
- `file`: `CreateFromTree` and `RevealInFileManager` move their tree controls into the menu;
  `File lifecycle operations are confined and permissioned` extends to folders; new requirements
  for downloading (file, folder, selection), for copying a folder, and for batch delete/move.
- `preview-file-attachments`: `Reference files from the file tree` — the reference control moves
  into the menu too, the `@` stays on the row (on hover, lit while referenced), folders can be referenced, and a selection
  can be referenced at once.

## Impact

- **UI**: `ui/src/components/FileTree.tsx` (rows, menu, selection, pick mode), a new menu component,
  `ui/src/components/Sidebar.tsx`, `ui/src/App.tsx`, `ui/src/useAgent.ts` (batch operations,
  download URL), `ui/src/util/workspacePath.ts`.
- **Protocol**: `shared/src/protocol.ts` gains `delete_files` / `move_files` and a batch result.
- **Server**: `server/src/index.ts` (download route, batch handlers), `server/src/fileBrowser.ts`
  (folder lifecycle, confined walk, stream for download), a streaming zip writer beside
  `office/src/zipWriter.ts`.
- **Tests**: `FileTree.test.tsx`, server lifecycle and route tests, a Playwright pass on the bench.
- **Docs**: the Files panel section of the user guide.
- Embed: the widget uses the same tree, so it gets the menu; the download URL carries the backend
  origin like `/files/raw` does.
