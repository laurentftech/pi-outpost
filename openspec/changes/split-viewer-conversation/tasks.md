# Tasks

## 1. Prototype and decisions

- [x] 1.1 Prototype overlay + peek, side by side and overlay + drawer on the real app; choose side by side (B). Record the outcome in `design.md`.
- [x] 1.2 Replace keyboard shortcuts with automatic focus return after sending; decide not to fold the Files sidebar automatically; hoist the header to full width.
- [x] 1.3 Decide where the overlay ↔ side-by-side toggle lives: "◫ beside chat" on the overlay status strip, "⊡ over chat" in the split viewer (prototype variant D).
- [ ] 1.4 Decide whether an out-of-window signal (tab title badge, notification) is wanted.

## 2. Header and layout

- [ ] 2.1 Hoist the header above the Files sidebar for every layout; verify header menus still overlay the sidebar, viewer and conversation, and `HeaderControlsShareOneRow` still holds.
- [ ] 2.2 Restructure the chat column so the mounted `FileViewer` can render as overlay or as a left pane beside the conversation without remounting; verify draft, undo history, caret and scroll survive the switch.
- [ ] 2.3 Add the adjustable divider with minimum widths and a persisted preference; collapse to overlay below the width threshold without remounting; leave the Files sidebar untouched.
- [ ] 2.4 Scope Work Plan, Analysis and Outcome panels to the conversation pane in side-by-side mode; verify each opens and closes correctly there.
- [ ] 2.5 Keep the conversation's scroll/stick-to-bottom behaviour in its pane while the editor has focus and the agent streams.

## 3. Sending and focus

- [ ] 3.1 Stop closing the viewer in `sendPrompt`; update tests that expected the close.
- [ ] 3.2 Return focus to the editor through `EditorView.focus()` after sending when focus came straight from it; leave focus alone otherwise.

## 4. Attention in overlay mode

- [ ] 4.1 Turn the viewer's activity strip into a status strip (replying, running a tool, failed, finished, needs you) whose action reveals the conversation without closing the viewer, with a "back to file" control.

## 5. Verify

- [ ] 5.1 Component tests for every scenario of the spec deltas; write `scenario-coverage.md` and run `npm run check:scenarios`.
- [ ] 5.2 Exercise in the running app with Playwright: write in a file while the agent streams side by side, resize across the threshold, send a prompt from the editor and keep typing, receive a question in overlay; then a break-it pass (rapid toggles, resize mid-stream, workspace switch with a dirty draft, file deleted on disk while open, question arriving during a save, header menus over every pane).
- [ ] 5.3 Delete the prototype (`ui/src/components/SplitViewerPrototype.tsx` and its `PROTOTYPE` hooks in `App.tsx`/`FileViewer.tsx`).
- [ ] 5.4 Run `npx openspec validate split-viewer-conversation --strict`, UI type checks and the relevant suites.
