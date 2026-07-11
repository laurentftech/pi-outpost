# Proposal: file-viewer-editor

## Why

The file browser sidebar only shows a cramped, read-only preview of a selected file. Users
want to actually read files comfortably (full-width view) and fix small things on the spot
(edit + save) without leaving the chat UI or asking the agent to do a trivial edit.

## What Changes

- Selected files open in a large view (main-pane overlay replacing the chat area while open,
  not the narrow sidebar preview), with line numbers and syntax highlighting.
- Files inside the writable zone become editable in that view: an Edit mode with a save
  action that writes the file back through the server.
- The server gains a `write_file` WebSocket operation, confined to the sandbox writable zone
  (same rules as the agent's write tool: `allowWrite` on, path inside `writableRoot`).
- Read-only files (outside the writable zone, or writes disabled) open in view-only mode with
  the edit action hidden/disabled.
- Guardrails: refuse to save files larger than the preview cap (would truncate content),
  detect concurrent modification (file changed on disk since it was opened) and warn instead
  of silently overwriting.

## Capabilities

### New Capabilities

_None — this extends the existing file browsing and wire-protocol capabilities._

### Modified Capabilities

- `file`: preview grows into a full-size viewer; new requirement to write a file back within
  the writable zone with size and staleness guards.
- `model`: `ClientMessage` gains `write_file` (path, content, requestId, baseline mtime);
  `ServerMessage` gains the corresponding success/error response.

## Impact

- `shared/src/protocol.ts` — new ClientMessage/ServerMessage variants.
- `server/src/fileBrowser.ts` — `writeFileFromBrowser` (confinement + staleness checks).
- `server/src/index.ts` — WS handler case for `write_file`.
- `web/src/components/Sidebar.tsx` / `FilePreview.tsx` — replaced/augmented by a large
  viewer-editor component; `web/src/App.tsx` layout; `web/src/useAgent.ts` new action + state.
- No dependency changes; editing UI uses a plain `<textarea>` (no code-editor library) in v1.
