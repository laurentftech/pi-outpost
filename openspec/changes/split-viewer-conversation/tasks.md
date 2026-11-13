# Tasks

## 1. Decide open questions

- [ ] 1.1 Choose the focus-composer and back-to-editor keys against browser-reserved keys, CodeMirror default bindings and existing app shortcuts; record them in `design.md`.
- [ ] 1.2 Decide where the layout toggle lives and whether a file opens side by side when that was the last choice; update the spec delta if it changes.

## 2. Side-by-side layout

- [ ] 2.1 Restructure the chat column so the mounted `FileViewer` can render as overlay or as a left pane beside the conversation without remounting; verify draft, undo history, caret and scroll survive the switch.
- [ ] 2.2 Add the adjustable divider with minimum widths and a persisted preference; collapse to overlay below the width threshold without remounting.
- [ ] 2.3 Scope Work Plan, Analysis and Outcome panels to the conversation pane in side-by-side mode; verify each opens and closes correctly there.
- [ ] 2.4 Keep the conversation's scroll/stick-to-bottom behaviour in its pane while the editor has focus and the agent streams.

## 3. Focus movement

- [ ] 3.1 Implement the two shortcuts; restore the editor's last selection on return; verify they never close the viewer or alter the draft.

## 4. Attention signals

- [ ] 4.1 Show a non-focus-stealing indicator on the viewer for a pending question, a grant request and the end of a turn, with an action that reveals the conversation in overlay mode.

## 5. Verify

- [ ] 5.1 Component tests for every scenario of the spec delta; write `scenario-coverage.md` and run `npm run check:scenarios`.
- [ ] 5.2 Exercise in the running app with Playwright: write in a file while the agent streams in side-by-side, resize across the threshold, use the shortcuts, receive a question in overlay; then a break-it pass (rapid toggles, resize mid-stream, workspace switch with a dirty draft, file deleted on disk while open, question arriving during a save).
- [ ] 5.3 Run `npx openspec validate split-viewer-conversation --strict`, UI type checks and the relevant suites.
