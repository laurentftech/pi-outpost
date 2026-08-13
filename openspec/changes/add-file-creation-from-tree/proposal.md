## Why

The file browser can open, edit, and save a file, and the tree shows Git badges for files that do
not exist yet on any branch — but there is no way to make one. `writeFileFromBrowser` refuses a
path that is not already a file (`conflict`), by design: that refusal is the guard against
clobbering a file someone else moved. So the only way to create a file today is to ask the agent
to do it, which needs write tools enabled and turns "add an empty note" into a prompt.

Creating a file where you are already looking is the missing half of a file browser.

## What Changes

- **A `+` control on a writable directory row**, shown on hover the way the existing `@` reference
  control is, and always visible on touch. Activating it opens an input line in the tree at that
  directory: type a name, Enter creates, Escape cancels.
- **Creating a directory** from the same control, so a new file can go somewhere new.
- **New protocol messages** `create_file` and `create_directory`. `write_file` is left alone: its
  refusal of a missing path is a safety property, not an oversight.
- **A created file opens in the viewer, in edit mode** — creating a file is wanting to write in it.
  A created directory expands in the tree instead.
- **Creation is confined exactly like a write**: inside the browser root, inside the writable zone,
  symlinks resolved. An existing name is refused rather than truncated.

Not in this change: renaming, deleting, moving, file templates, and creating anything outside the
writable zone. Rename and delete act on files the agent may be reading — they deserve their own
change, with their own answer for what happens to an open viewer and a running turn.

## Capabilities

### New Capabilities

*(none — this extends the existing file-browser capability)*

### Modified Capabilities
- `file`: gains creation of a file and of a directory from the browser, under the same confinement
  and writable-zone rules as `WriteFileFromBrowser`, plus the tree-side flow that names them.
- `api`: gains the `create_file` and `create_directory` client messages and their answers.
- `components`: `WorkspaceAndGitNavigation` — `FileTree` gains a creation affordance and reports
  the requested path through a callback, like every other mutation it surfaces.

## Impact

**Server**: `server/src/fileBrowser.ts` (two new functions beside `writeFileFromBrowser`, reusing
`resolveConfined` and the writable-zone check — never a new confinement path),
`server/src/index.ts` (two message handlers, each broadcasting `file_changed` so every connected
client's tree refreshes through the machinery that already exists).

**Shared**: `shared/src/protocol.ts` — two client messages; the existing `file_browser_error`
carries the failures, with `conflict` reused for "that name is taken".

**UI**: `ui/src/components/FileTree.tsx` (the control and the inline input row),
`ui/src/components/Sidebar.tsx` and `ui/src/App.tsx` (wiring), `ui/src/useAgent.ts` (the two
actions and their optimistic tree refresh).

**Security**: a user-supplied *name* becomes a path segment. The server resolves and confines it as
it does for any other path, and both sides reject separators and `.`/`..` — a name is a name, not
a route.
