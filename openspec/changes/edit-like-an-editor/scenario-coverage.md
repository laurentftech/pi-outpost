# Scenario coverage — edit-like-an-editor

One modified requirement, `file` → `FullSizeFileViewer` (13 scenarios; three new). Evidence:

- **In the running app:** `e2e/file-editor.spec.ts` writes a source file into the primary project,
  opens it in the viewer, and drives the editor with the keyboard; it reads the draft back from the
  editor's lines and the saved bytes back from disk.
- **The editor:** `ui/src/components/CodeEditor.test.tsx` (real CodeMirror in jsdom).
- **The viewer:** `ui/src/components/FileViewer.test.tsx`, `FileViewer.find.test.tsx`,
  `FileViewer.split.test.tsx`, `FileViewer.docxExport.test.tsx`, now typing through the editor
  (`ui/src/components/codeEditorTesting.ts`) instead of a textarea.
- **Destructive pass:** `scripts/probes/bench-code-editor.mts` against `npm run bench`: inside the
  embed's Shadow DOM under hostile CSS (CodeMirror's base theme and the token colours applied),
  edit/done spammed, a file switched with an unsaved draft, find in edit mode on a match far down,
  the file deleted under the editor then saved (the conflict banner, nothing written), a split
  Markdown draft, the dark theme. Nothing broke.

## file

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheEditorNumbersAndColoursLines | covered | `e2e/file-editor.spec.ts` — "TheEditorNumbersAndColoursLines: numbers, colours as typed, brackets, Tab, several cursors and undo": gutter numbers 1–6 for five lines and the trailing empty one; `.tok-keyword` "const" in a colour other than the text's, the comment as `.tok-comment`; typed `'yes'` coloured as a string; `ask(` becomes `ask()` with both brackets `.cm-matchingBracket`; Tab types two spaces and Shift+Tab removes them; double click + Ctrl+D + typing renames both `answer`s; Ctrl+Z restores them; a wrapped line is over twice a line's height and the last number equals the line count. `ui/src/components/CodeEditor.test.tsx` — "numbers the lines, colours the language once loaded…", "closes brackets as they are typed, and indents with the file's unit". |
| SavingKeepsTheEditorOpen | covered | `e2e/file-editor.spec.ts` — "SavingKeepsTheEditorOpen: Ctrl+S writes the file and stays in the editor; done leaves without asking": the file on disk holds the draft, the editor is still there and focused, save is disabled; a second Ctrl+S writes again with no conflict banner; "done" closes the editor with no dialog. `ui/src/components/FileViewer.test.tsx` — "stays in the editor once a Ctrl+S save lands, clean, and done leaves without asking" checks the second save carries the new mtime. `ui/src/components/CodeEditor.test.tsx` — "saves on Ctrl+S and on Cmd+S, without the browser's own save". |
| ACrlfFileStaysCrlf | covered | `e2e/file-editor.spec.ts` — "ACrlfFileStaysCrlf: a CRLF file is saved with CRLF, the new line included": the saved bytes are `first\r\nsecond\r\nthird\r\n`. `ui/src/components/CodeEditor.test.tsx` — "keeps a CRLF file's line endings in the draft it reports"; `ui/src/components/FileViewer.find.test.tsx` — "selects the match itself in a CRLF file, where a line break is one position". |
| OpenFileFullSize | covered | `ui/src/components/FileViewer.test.tsx` — "names the open file", "shows the file while it is still loading", "surfaces a read error instead of an empty pane". Unchanged by this change; the editor tests above now type through CodeMirror. |
| OpenPdfFullSize | covered | `ui/src/components/FileViewer.pdf.test.tsx` — "renders the PDF instead of the binary-file refusal". Unchanged by this change; the editor tests above now type through CodeMirror. |
| PdfIsNotEditable | covered | `ui/src/components/FileViewer.pdf.test.tsx` — "offers no edit action, even inside the writable zone". Unchanged by this change; the editor tests above now type through CodeMirror. |
| EditableFile | covered | `ui/src/components/FileViewer.test.tsx` — "offers editing when everything is writable", "offers editing inside the writable subtree", "submits the draft with the baseline mtime". Unchanged by this change; the editor tests above now type through CodeMirror. |
| ReadOnlyFile | covered | `ui/src/components/FileViewer.test.tsx` — "marks the file read-only when nothing is writable", "refuses editing outside the writable subtree", "does not mistake a sibling with a shared prefix for the writable subtree". Unchanged by this change; the editor tests above now type through CodeMirror. |
| DirtyCloseConfirmed | covered | `ui/src/components/FileViewer.split.test.tsx` — the discard-confirmation path on close with an unsaved buffer. Unchanged by this change; the editor tests above now type through CodeMirror. |
| PreviewAttachmentAvailable | covered | `ui/src/components/FileViewer.test.tsx` and `ui/src/App.test.tsx` — the attachment offered once a file has displayed. Unchanged by this change; the editor tests above now type through CodeMirror. |
| WordDownloadOfferedForText | covered | `ui/src/components/FileViewer.docxExport.test.tsx` — "offers it for a markdown file", "offers it for a text file that is not markdown", "offers it in source mode as well as rendered". |
| WordDownloadIgnoresTheWritableZone | covered | `ui/src/components/FileViewer.docxExport.test.tsx` — "offers it for a read-only file, because a download is not a write": asserts the read-only lock is showing *and* the export button is present, so a regression that gated the export on writability fails here. |
| NoWordDownloadForBinaryOrDiff | covered | `ui/src/components/FileViewer.docxExport.test.tsx` — "does not offer it for an image", "does not offer it for a PDF", "does not offer it for a file that failed to load", "does not offer it while the uncommitted diff is showing". |
