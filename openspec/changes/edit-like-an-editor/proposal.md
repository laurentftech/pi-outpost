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
- **The viewer's find bar still searches the draft** in edit mode, selecting the match in the editor;
  CodeMirror's own search panel is left out so Ctrl+F stays one thing.
- **Saving stays in the editor.** Ctrl+S (Cmd+S) or the save action writes the file and keeps the
  editor open on the new baseline. The cancel action reads "done" when nothing is unsaved.
- **CRLF files stay CRLF.**
- **Loaded on demand:** the editor is its own chunk (~100 kB gzip), fetched when a writable file is
  shown, not with the application.

## Capabilities

### Modified Capabilities

- `file`: `FullSizeFileViewer` — the Edit mode behaves as a code editor, and a save no longer leaves it.

## Impact

- **`ui/src/components/`**: `CodeEditor.tsx`, `codeEditorLanguages.ts`, `lazyCodeEditor.ts` (new);
  `FileViewer.tsx` uses the editor, finds through it, and keeps it open after a save.
- **`web/src/index.css`**: the editor's chrome and `tok-*` colours.
- **Dependencies:** `@codemirror/*` and `@lezer/highlight` in `ui`.
- **Tests:** unit tests drive the editor through `codeEditorTesting.ts`; `e2e/file-editor.spec.ts`.
- **Bench probe:** `scripts/probes/bench-code-editor.mts`.
- **No server change.**
- **Docs:** `README.md` (the file browser's editor).
