# Design: file-viewer-editor

## Context

The sidebar file browser lets users open a file, but the preview (`FilePreview.tsx`) lives in
the narrow sidebar column: fine for a glance, bad for reading, impossible for editing. The
server already has a confined read path (`readFileForPreview`: `resolveConfined` +
1 MiB cap + binary sniff) and already computes the writable zone for the UI
(`resolveWritableRoot`: `undefined` = no sandbox, `null` = read-only sandbox, string =
writable subtree, `""` = whole root). There is no write path from the browser; only agent
tools can modify files. A `file_changed` ServerMessage already broadcasts agent-side file
mutations.

## Goals / Non-Goals

**Goals:**
- Read files comfortably: full-main-pane viewer with syntax highlighting (reuse
  `CodeHighlight`) and rendered-markdown toggle (reuse `FilePreview` behavior).
- Edit and save files where the agent itself could write them, from the same viewer.
- Server-enforced confinement identical to agent tool rules; the client UI state is a hint,
  never the authority.
- Detect mid-edit external changes (agent or other process wrote the file) before saving.

**Non-Goals:**
- No code-editor library (CodeMirror/Monaco): v1 is a monospace `<textarea>`. Bundle size and
  Shadow-DOM embed compatibility outweigh editor niceties for small fixes.
- No new-file creation, rename, or delete from the browser.
- No multi-tab or side-by-side editing; one file open at a time (as today).
- No binary or >1 MiB file editing (read path already refuses them).

## Decisions

1. **Viewer placement: overlay over the chat main pane**, toggled by selecting a file, closed
   with ✕/Esc. Alternatives: keep in sidebar (too narrow — the problem itself), modal
   (cramped, awkward on small screens), separate route (no router in the app; overkill).
   The chat stays mounted underneath so streaming state is untouched.

2. **Write permission mirrors agent tool permissions.** Server allows `write_file` iff:
   no sandbox is configured (agent has unrestricted built-ins; browser root = cwd), or
   `sandbox.allowWrite` and the resolved path is inside the writable zone. Implemented as
   `writeFileFromBrowser(root, writableRel, relPath, content, expectedMtimeMs)` in
   `fileBrowser.ts`, reusing `resolveConfined` against the *writable* root. Client enables
   the Edit button from `state.writableRoot` (`undefined` → everywhere, `null` → nowhere,
   string → inside that subtree) but the server re-checks everything.

3. **Staleness guard via mtime handshake.** `file_content` gains `mtimeMs`; `write_file`
   carries it back as `expectedMtimeMs`. Before writing, the server stats the file: mismatch
   → `file_browser_error` with new reason `"conflict"`; the client offers "reload" (discard
   edits) or "overwrite with my version". Overwrite sends `force: true`, which skips only the
   mtime comparison (permission and size checks still apply) — found in E2E: the client cannot
   supply a fresh mtime because external writes broadcast no `file_changed`, so a mtime-based
   override would loop on conflict forever. Alternatives: content hash (more bytes, no better
   for local FS), no guard (proposal explicitly wants one). Missing file at save time is also
   a conflict (file deleted underneath), even with force.

4. **Wire protocol additions** (in `shared/src/protocol.ts`):
   - ClientMessage: `{ type: "write_file"; path: string; content: string; expectedMtimeMs: number; requestId: string }`
   - ServerMessage: `{ type: "file_written"; requestId: string; path: string; size: number; mtimeMs: number }`
   - `file_browser_error` reused for failures (reason string already flows through `message`).
   Content size on the frame is naturally bounded by the 1 MiB read cap plus edits; the server
   rejects content > `MAX_PREVIEW_BYTES` with `"too-large"` so a saved file always remains
   reopenable.

5. **After a successful save**, the server broadcasts the existing `file_changed` message so
   every connected client refreshes its tree/preview, and answers the writer with
   `file_written` carrying the new `mtimeMs` so the editor can keep editing without a reload.

## Risks / Trade-offs

- [User edits a file the agent is concurrently rewriting] → mtime conflict check at save +
  `file_changed` banner in the open editor ("file changed on disk — reload?").
- [textarea UX is spartan for large files] → acceptable for v1 scope (small fixes); viewer
  keeps highlighting for reading, Edit mode is opt-in per file.
- [mtimeMs precision varies by filesystem] → compare as numbers exactly; both values come
  from the same `fs.stat` source so equality is reliable on a given FS.
- [Unsaved edits lost by closing/navigating] → confirm-on-close when the buffer is dirty.
  Known limitation: selecting a *different* file in the tree remounts the viewer (`key`ed by
  path — required so a draft can never be saved onto another file) and discards a dirty draft
  without confirmation.

## Migration Plan

Additive protocol change; old clients simply never send `write_file`. No config migration:
permissions derive from the existing sandbox settings. Rollback = revert commit.

## Open Questions

- None blocking. (Keyboard shortcut for save — Cmd/Ctrl+S — decided during implementation.)
