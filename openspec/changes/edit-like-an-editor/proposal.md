# Proposal

## Why

The file viewer's Edit mode is a bare textarea: no syntax colours, no line numbers, and saving throws
the user out of the editor back to the rendered view, so Ctrl+S cannot be used as it is in any
editor. The user wants editing to behave as a modern code editor: line numbers, colours, Ctrl+S
saving without leaving the editor, and the rest of what one expects from one.

## What Changes

- **The editor is CodeMirror 6**, set up as a code editor: line numbers, the current line marked,
  syntax colours as typed (on the read-only view's palette, light and dark), brackets and quotes
  closed and matched, Tab / Shift+Tab as in VS Code, several cursors (Ctrl+D, Alt-click, Alt-drag),
  moving and copying lines (Alt+arrows), Ctrl+/ comments, folding, undo history, completion on
  Ctrl+Space. Long lines wrap. Languages load per file kind.
- **Reading looks like editing:** a text file's source (the source view, and the split's left pane
  outside the writable zone) is shown in the same editor, read-only. highlight.js draws it only while
  the editor's code loads.
- **Find, in the source read or edited, goes through the editor:** every match marked by it (it
  draws only the lines in view, so marks written into its DOM would be lost), the current one
  selected and scrolled to. Matches are now marked while editing too. Switching view under the same
  query keeps the current match. CodeMirror's own search panel is left out so Ctrl+F stays one thing.
- **Saving stays in the editor.** Ctrl+S (Cmd+S) or the save action writes the file and keeps the
  editor open on the new baseline. The cancel action reads "done" when nothing is unsaved.
- **CRLF files stay CRLF.**
- **Loaded on demand:** the editor is its own chunk (~100 kB gzip), fetched when a text file is
  shown, not with the application.

## Capabilities

### Modified Capabilities

- `file`: `FullSizeFileViewer` — the Edit mode behaves as a code editor, a save no longer leaves it,
  and a source read without editing is shown in the same editor, read-only.
- `viewer-find-in-page`: `EditModeUsesNativeSelection` is removed for `SourceMatchesAreDrawnByTheEditor`
  — matches in the source, read or edited, are drawn by the editor, all of them, and a view switch
  keeps the current match.

## Impact

- **`ui/src/components/`**: `CodeEditor.tsx`, `codeEditorLanguages.ts`, `lazyCodeEditor.ts` (new);
  `FileViewer.tsx` uses the editor, finds through it, and keeps it open after a save.
- **`web/src/index.css`**: the editor's chrome and `tok-*` colours.
- **Dependencies:** `@codemirror/*` and `@lezer/highlight` in `ui`.
- **Tests:** unit tests drive the editor through `codeEditorTesting.ts`; `e2e/file-editor.spec.ts`.
- **Bench probe:** `scripts/probes/bench-code-editor.mts`.
- **No server change.**
- **Docs:** `README.md` (the file browser's editor).
