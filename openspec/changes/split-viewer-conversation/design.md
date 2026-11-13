# Design

## Context

`FileViewer` renders `absolute inset-0 z-20` inside the chat column (`ui/src/components/FileViewer.tsx`), above the transcript; the `Composer` lives in the `<footer>` outside that column (`ui/src/App.tsx`) and stays usable. The composer is hidden while an extension question or a sandbox grant is pending (`hidden={!!(question || grant)}`). Right-hand panels (Work Plan `md:w-[23rem]`, Analysis/Outcome `26rem`) overlay the conversation and pad it. The viewer is remounted per file path so a draft never lands on another file, and is cleared on `hello` / `workspace_switched` / `session_replaced`.

The triggering use: the user writes in a file while the agent runs an unrelated task, and has to leave the file to follow the agent.

## Goals / Non-Goals

**Goals:**
- See the live conversation and the file at the same time on a wide window.
- Move between editor and composer from the keyboard, returning to the same caret position.
- Never lose an edit draft, caret, selection or scroll when switching layout or while the agent streams.
- Be told when the agent needs the user or has finished, without watching the conversation.

**Non-Goals:**
- Multiple open files, tabs or editor groups.
- Detecting or merging concurrent agent writes to the file being edited (the existing mtime conflict guard on save remains the protection).
- Changing the mobile/narrow layout beyond the attention signal.

## Decisions

### Split is a layout of the same viewer, not a second viewer

The split reuses the mounted `FileViewer`; switching overlay ↔ split changes its container, not its key, so CodeMirror state (draft, history, caret, scroll) is preserved. Re-mounting on layout change is rejected: it would drop undo history and caret, which is exactly the interruption being removed.

### Viewer on the left, conversation on the right, resizable

The conversation keeps its own scroll and stick-to-bottom behaviour in its pane. The divider position is a per-browser preference (local storage, with a sane default ~60/40 and minimum widths for both panes). Right-hand panels (Work Plan, Analysis, Outcome) overlay the conversation pane only, as they overlay the conversation column today.

### Split only above a width threshold; overlay below

Below the threshold (provisionally the `lg` breakpoint, 1024 px) the overlay stays. Crossing the threshold while split collapses to overlay without unmounting. The user's choice (split vs overlay) is remembered as a preference and applies when the width allows.

### Focus movement shortcuts

A shortcut focuses the composer from anywhere, another returns to the viewer's editor and restores its last selection. Constraints for choosing keys: must not be reserved by browsers (`Cmd/Ctrl+L` focuses the address bar), must not collide with CodeMirror defaults (`Ctrl-l` is `selectLine` on macOS, `Ctrl-e` is line end) or with the existing `Ctrl/Cmd+\`` terminal toggle, and `Escape` already closes the viewer. Final key choice is an open question; the behaviour is specified independently of the keys.

### Attention signals while in the viewer

When a question or grant arrives, or the agent's turn ends, while the viewer has focus: in split mode the conversation pane shows it; in overlay mode a non-modal indicator on the viewer (and the existing document title/notification mechanism, if any) shows it, with an action that reveals the conversation. The indicator never steals focus from the editor.

## Risks / Trade-offs

- [Layout complexity with right-hand panels] → keep panels scoped to the conversation pane; test each panel open in split mode.
- [Agent writes the open file while the user edits] → unchanged: save is guarded by mtime; the viewer's existing reload/conflict path applies. Out of scope to improve here.
- [Workspace switch clears the viewer] → unchanged; dirty-close confirmation rules apply as today.
- [Narrow pane readability] → minimum widths; collapse to overlay below them.

## Open Questions

- Shortcut keys for "focus composer" and "back to editor".
- Should the split toggle live only in the viewer toolbar, or also in the header?
- Should opening a file default to split when the window is wide (if the user previously chose split), or always open as overlay?
