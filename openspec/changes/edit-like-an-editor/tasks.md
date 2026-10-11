# Tasks

## 1. The editor

- [x] 1.1 `CodeEditor` (CodeMirror 6): extensions, keymap (Ctrl/Cmd+S, Ctrl+D, Tab as in VS Code), CRLF, languages per file kind, lazy chunk.
- [x] 1.2 `FileViewer`: use it; find selects through it; a landed save rebases the baseline instead of leaving; "done" when clean.

## 2. Checks

- [x] 2.1 Unit tests; e2e in the running app (`TheEditorNumbersAndColoursLines`, `SavingKeepsTheEditorOpen`, `ACrlfFileStaysCrlf`); destructive pass in the bench (embed Shadow DOM, edit/done spam, file switched mid-edit, find, file deleted under the editor, split, dark).
- [x] 2.2 `README.md`; `scenario-coverage.md`, `check:scenarios`, `openspec validate --strict`.
