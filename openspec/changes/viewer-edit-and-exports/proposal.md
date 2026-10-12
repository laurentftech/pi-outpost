# Proposal

## Why

Clicking edit while a Markdown, HTML or structured-exchange file shows its rendering kept the viewer in
"rendered": the editor opened full width while the mode control still said "rendered", and the
rendering the reader was looking at disappeared.

## What Changes

- Edit from the rendering moves to the side-by-side mode — the editor beside the rendering — or to the
  source alone when there is no room for two panes.
- Leaving the editor (done, or cancel) brings the rendering back. A mode the reader chose meanwhile is
  theirs: leaving the editor then keeps it.

- In the viewer's toolbar, a structured-exchange document exports what it draws: a graph, a sequence
  or a timeline its figure as SVG (beside where the Word export sits for other files — the button
  under the figure was easy to miss), a table a Word document holding the table and an Excel
  workbook. Its JSON is no longer offered as Word text, which exported the source, not the drawing.
  The exports go through the rendered document, so they carry what the reader narrowed.

- A graph the reader rearranged by dragging boxes fits its canvas to what is drawn, so pulling boxes
  together shrinks the figure and its SVG — the canvas used to only grow. An untouched figure keeps its
  layout's canvas.

## Capabilities

### Modified Capabilities

- `file`: `EditingFromTheRenderingMovesToTheText` is added; `FullSizeFileViewer` no longer offers a
  structured-exchange document as Word text, and gains `AStructuredExchangeFileExportsWhatItDraws`.
- `structured-exchange`: `ARearrangedFigureFitsWhatIsDrawn` is added.

## Impact

- `ui/src/components/FileViewer.tsx`, `DocxExportButton.tsx` (text read when pressed);
  `ui/src/presentations/StructuredExchangeView.tsx`, `TimelineView.tsx`, `documentExport.ts` (the
  document's exports, offered to the toolbar).
- `shared/src/structuredExchangeFigure.ts`: the canvas extent once boxes are moved.
- Tests: `server/test/structuredExchangeFigureFit.test.ts`, `FileViewer.split.test.tsx`, `FileViewer.docxExport.test.tsx`, `e2e/file-editor.spec.ts`,
  `e2e/docx-export-app.spec.ts`.
