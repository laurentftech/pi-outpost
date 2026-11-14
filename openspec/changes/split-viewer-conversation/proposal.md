# Proposal

## Why

The file viewer covers the whole chat pane (`FullSizeFileViewer`), and sending a prompt closes it unless it holds unsaved edits. A user who writes in a file while the agent works on something else cannot follow the agent without leaving the file: the conversation — streamed reply, tool activity, a question waiting for an answer — is hidden, and coming back means reopening or clicking back into the editor and finding the place again. Working in parallel with the agent, which is the point of delegating a task, is interrupted by the layout.

## What Changes

- On a wide enough window, the file viewer and the live conversation are shown side by side, with a draggable divider; below that width the viewer keeps today's full-size overlay. Validated with a prototype on the real app (variant B).
- The application header spans the full window width, above the Files sidebar; opening a file side by side leaves the sidebar as the user set it.
- Sending a prompt no longer closes the viewer.
- After sending a prompt typed straight after editing, focus returns to the editor at the same caret — no shortcut to learn.
- Edit drafts, undo history, caret, selection and scroll survive switching layout and the agent streaming.
- In overlay mode, the viewer's status strip shows what the agent is doing and when it needs the user, and reveals the conversation without closing the viewer.

## Capabilities

### Modified Capabilities
- `file`: the viewer can sit beside the conversation, stays open on send, returns focus after sending, and signals agent attention in overlay mode.
- `components`: the header spans the window above the Files sidebar.

### New Capabilities
- None.

## Impact

- `ui/src/App.tsx` layout: header hoisted above the sidebar; the viewer, currently `absolute inset-0` inside the chat column, can render as a left pane; `sendPrompt` no longer calls `closePreview`; right-hand panels (Work Plan, Analysis, Outcome) scoped to the conversation pane.
- `ui/src/components/FileViewer.tsx`: layout toggle, status strip that reveals instead of closing.
- Focus restoration through CodeMirror's `EditorView.focus()`.
- Existing tests asserting the overlay (`OpenFileFullSize`) keep passing for narrow windows; tests that expect the viewer to close on send must change.
- No server or protocol change.
