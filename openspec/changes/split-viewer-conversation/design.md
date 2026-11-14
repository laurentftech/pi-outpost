# Design

## Context

`FileViewer` renders `absolute inset-0 z-20` inside the chat column (`ui/src/components/FileViewer.tsx`), above the transcript; the `Composer` lives in the `<footer>` outside that column (`ui/src/App.tsx`) and stays usable. `sendPrompt` closes the viewer on every send unless it holds unsaved edits, and the viewer's activity strip ("π is replying… / show conversation →") closes it too. The composer is hidden while an extension question or a sandbox grant is pending (`hidden={!!(question || grant)}`). Right-hand panels (Work Plan `md:w-[23rem]`, Analysis/Outcome `26rem`) overlay the conversation and pad it. The viewer is remounted per file path so a draft never lands on another file, and is cleared on `hello` / `workspace_switched` / `session_replaced`. The header sits inside the main column, so an open Files sidebar runs up to the top of the window beside it.

The triggering use: the user writes in a file while the agent runs an unrelated task, and has to leave the file to follow the agent.

## Prototype outcome

Three variants were built on the real app (branch `prototype/split-viewer`, `?variant=A|B|C` in dev builds) and exercised against a real server:

- **A — overlay + peek**: status strip on the viewer, peek at the conversation without closing it.
- **B — side by side**: viewer and live conversation in two panes. **Chosen.**
- **C — overlay + drawer**: the latest reply streams into a drawer at the bottom of the viewer. Rejected: it takes height from the editor exactly when the user writes, and shows only the last reply as plain text.

Findings that shaped the decisions below:
- With the header inside the conversation column, side by side squeezed it onto three rows; hoisting the header to full width fixed it.
- Folding the Files sidebar automatically when splitting was tried and rejected by the user: the sidebar stays as the user left it.
- The user forgets shortcuts; returning focus automatically after sending replaced them.
- A bare DOM `focus()` on CodeMirror's content put the caret back at the start of the document; focus must go through `EditorView.focus()`, which restores the editor's own selection.

## Goals / Non-Goals

**Goals:**
- See the live conversation and the file at the same time on a wide window.
- Never close the viewer because a prompt was sent.
- Come back to the editor after sending, at the same caret, with nothing to remember.
- Never lose an edit draft, caret, selection or scroll when switching layout or while the agent streams.
- Be told when the agent needs the user or has finished when the conversation is not visible.

**Non-Goals:**
- Multiple open files, tabs or editor groups.
- Detecting or merging concurrent agent writes to the file being edited (the existing mtime conflict guard on save remains the protection).
- Keyboard shortcuts for moving between editor and composer.

## Decisions

### Side by side is a layout of the same viewer, not a second viewer

The split reuses the mounted `FileViewer`; switching overlay ↔ split changes its container, not its key, so CodeMirror state (draft, history, caret, scroll) is preserved. Re-mounting on layout change is rejected: it would drop undo history and caret, which is exactly the interruption being removed. (The prototype remounts on variant switch; the implementation must not.)

### Viewer on the left, conversation on the right, resizable, below a full-width header

The header spans the window; below it, the optional Files sidebar, then the viewer pane, a divider, and the conversation pane with its composer. The conversation keeps its own scroll and stick-to-bottom behaviour. The divider position is a per-browser preference stored as a share of the space beside the sidebar (default ≈ 58 % for the viewer; minimum 360 px viewer, 380 px conversation). Right-hand panels (Work Plan, Analysis, Outcome) overlay the conversation pane only.

### The Files sidebar is left alone

Opening a file side by side does not fold or move the sidebar; the user folds it with the existing Files control when space is short. Three columns on a laptop width are tight (viewer toolbar labels are cut, usage counters wrap) but usable.

### Split only above a width threshold; overlay below

Below the threshold (provisionally the `lg` breakpoint, 1024 px, applied to the space beside the sidebar) the overlay stays. Crossing the threshold while split collapses to overlay without unmounting. The user's choice (split vs overlay) is remembered and applies when the width allows.

### Sending keeps the viewer open; focus returns automatically

`sendPrompt` no longer closes the viewer. If focus came to the composer directly from the viewer's editor, sending gives focus back to that editor through `EditorView.focus()`. If it came from elsewhere, focus is left alone.

### Attention in overlay mode

When the viewer overlays the chat pane, its status strip shows replying / running a tool / failed / finished / needs you (question or grant, highlighted), and its action reveals the conversation without closing the viewer, with a "back to file" control. In side-by-side mode the conversation pane is the signal.

## Risks / Trade-offs

- [Layout complexity with right-hand panels] → keep panels scoped to the conversation pane; test each panel open in split mode.
- [Hoisting the header changes every layout, not only the split] → the header menus must still overlay the sidebar and panes; covered by a scenario.
- [Agent writes the open file while the user edits] → unchanged: save is guarded by mtime; out of scope here.
- [Workspace switch clears the viewer] → unchanged; dirty-close confirmation rules apply as today.
- [Three columns on narrow laptops] → user folds the sidebar; minimum widths collapse to overlay below them.

### Toggle: "◫ beside chat" on the status strip, "⊡ over chat" in the split viewer

The overlay's status strip is always present (it says "idle" when nothing happens) and carries "conversation ↗" (peek) and "◫ beside chat"; the side-by-side viewer carries "⊡ over chat". The word "split" is avoided: the viewer toolbar already uses "⇹ split" for editing beside the rendering. "beside chat" is hidden below the width threshold. In the prototype (variant D) the viewer stays mounted in one place and is positioned over the chat area in overlay mode, which keeps draft and undo history across both switches — the approach the implementation should follow.

## Open Questions

- Whether a signal outside the window (tab title badge, system notification) is wanted when the agent needs the user.
