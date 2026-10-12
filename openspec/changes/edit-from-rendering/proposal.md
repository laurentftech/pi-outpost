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

## Capabilities

### Modified Capabilities

- `file`: `EditingFromTheRenderingMovesToTheText` is added.

## Impact

- `ui/src/components/FileViewer.tsx`. Tests: `FileViewer.split.test.tsx`, `e2e/file-editor.spec.ts`.
