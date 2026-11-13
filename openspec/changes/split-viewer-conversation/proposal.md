# Proposal

## Why

The file viewer covers the whole chat pane (`FullSizeFileViewer`). A user who writes in a file while the agent works on something else cannot follow the agent without leaving the file: the composer stays usable below the viewer, but the conversation — streamed reply, tool activity, a question waiting for an answer — is hidden. Following the agent means closing or covering the editor, then clicking back into it and finding the place again. Working in parallel with the agent, which is the point of delegating a task, is interrupted by the layout.

## What Changes

- On a wide enough window, the file viewer and the conversation can be shown side by side: the viewer on one side, the live conversation on the other, with a draggable divider. The user switches between the existing overlay and the split from the viewer.
- Below that width, the viewer keeps today's full-size overlay.
- Edit drafts, cursor, selection and scroll position survive switching between overlay and split, and survive the agent streaming in the other pane.
- Keyboard shortcuts move focus between the editor and the composer without the mouse, returning to the editor where the caret was.
- While the user is in the viewer, a question, a permission grant or the end of the agent's turn is signalled visibly even in overlay mode, so the user is not required to watch the conversation.

## Capabilities

### Modified Capabilities
- `file`: `FullSizeFileViewer` allows a side-by-side layout with the conversation on wide windows instead of always overlaying the chat pane.

### New Capabilities
- None; focus movement and agent-attention signals are specified as part of `file`.

## Impact

- `ui/src/App.tsx` layout: the viewer currently mounts `absolute inset-0` inside the chat column, alongside right-hand panels (Work Plan, Analysis, Outcome) that reserve `md:pr-[23rem]`/`md:pr-[26rem]` of the conversation.
- `ui/src/components/FileViewer.tsx` (toolbar toggle, preserved editor state) and `ui/src/components/CodeEditor.tsx` (focus restore).
- `ui/src/components/Composer.tsx` focus entry point.
- Existing tests asserting the overlay (`OpenFileFullSize`) keep passing for narrow windows; new tests for split, focus movement and attention signals.
- No server or protocol change.
