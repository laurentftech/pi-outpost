# Tasks

## 1. Prototype and decisions

- [x] 1.1 Prototype overlay + peek, side by side and overlay + drawer on the real app; choose side by side (B). Record the outcome in `design.md`.
- [x] 1.2 Replace keyboard shortcuts with automatic focus return after sending; decide not to fold the Files sidebar automatically; hoist the header to full width.
- [x] 1.3 Decide where the overlay ↔ side-by-side toggle lives: "◫ beside chat" on the overlay status strip, "⊡ over chat" in the split viewer (prototype variant D).
- [x] 1.4 Decide whether an out-of-window signal is wanted: a tab title mark, no system notification.

## 2. Header and layout

- [x] 2.1 Hoist the header above the Files sidebar for every layout; verify header menus still overlay the sidebar, viewer and conversation, and `HeaderControlsShareOneRow` still holds.
- [x] 2.2 Restructure the chat column so the mounted `FileViewer` can render as overlay or as a left pane beside the conversation without remounting; verify draft, undo history, caret and scroll survive the switch.
- [x] 2.3 Add the adjustable divider with minimum widths and a persisted preference; collapse to overlay below the width threshold without remounting; leave the Files sidebar untouched.
- [x] 2.4 Scope Work Plan, Analysis and Outcome panels to the conversation pane in side-by-side mode; verify each opens and closes correctly there.
- [x] 2.5 Keep the conversation's scroll/stick-to-bottom behaviour in its pane while the editor has focus and the agent streams.

## 3. Sending and focus

- [x] 3.1 Stop closing the viewer in `sendPrompt`; update tests that expected the close.
- [x] 3.2 Return focus to the editor through `EditorView.focus()` after sending when focus came straight from it; leave focus alone otherwise.

## 4. Attention in overlay mode

- [x] 4.1 Turn the viewer's activity strip into a status strip (replying, running a tool, failed, finished, needs you) whose action reveals the conversation without closing the viewer, with a "back to file" control.

## 4b. Usability review fixes

- [x] 4.2 Peek: scroll to the latest message, focus the composer, in-flow bar with "back to file" and "beside chat"; back restores the editor's focus and caret.
- [x] 4.3 Layout, strip and save controls keep the editor focused and are at least 24×24 px.
- [x] 4.4 Keep following a streamed reply when the transcript grows without the reader moving up.
- [x] 4.5 No sideways page scroll: viewer toolbar and composer status row wrap; Files sidebar becomes a drawer below md and closes when a file is opened from it.

## 4c. Tree and attention additions

- [x] 4.6 File rows: a mouse click selects (and shows the single selection), double-click, Enter or a tap opens; update unit and e2e tests that relied on one click.
- [x] 4.7 Copy relative path / Copy absolute path in the row and selection menus; the server sends `browserRoot`; the absolute path uses the server's separator; a brief confirmation.
- [x] 4.8 Mark the tab title when the agent needs the user or finished while the tab is in the background; never in an embedded widget.

## 5. Verify

- [x] 5.1 Component tests for every scenario of the spec deltas; write `scenario-coverage.md` and run `npm run check:scenarios`.
- [x] 5.2 Exercise the running app with Playwright: file-editor split/resize/dirty-draft break-it test; 40 viewport/layout configurations at four widths; header-menu checks; 390px search/action geometry check; integrated-widget Escape test.
- [x] 5.3 Delete the prototype (`ui/src/components/SplitViewerPrototype.tsx` and its `PROTOTYPE` hooks in `App.tsx`/`FileViewer.tsx`).
- [x] 5.4 Run `npx openspec validate split-viewer-conversation --strict`, UI type checks and the relevant suites.
