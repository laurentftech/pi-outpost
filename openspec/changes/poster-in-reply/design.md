# Design

## Decisions

- **Read-only frame, not the editor.** The file viewer's `PosterFrame` loads the whole poster editor
  (GrapesJS bundle, save flow, draw.io painters) — heavy for a reply. A reply needs only the page: fetch
  the `.poster.html` once via `/files/raw`, `readPage` it, and render `pageOf(...)` in an iframe's `srcDoc`.
  One fetch, one iframe, no editor bundle.
- **`sandbox=""` on the frame.** A poster holds no script (`checkPoster` refuses `<script>`), and with no
  `allow-scripts`/`allow-same-origin` the page gets an opaque origin and cannot reach the host page — the
  same guarantee the sanitizer gives raw HTML in replies, applied to a whole page. Pictures embedded as
  data URLs still render.
- **Sizing.** The frame is the paper format's size in CSS pixels (`FORMATS`), scaled by a `ResizeObserver`
  to fit the reply width and capped at `max-h-96` (384 px), the same cap pictures in replies get.
- **Detection mirrors draw.io's**: `isWorkspacePoster` in `markdownPoster.tsx` (workspace-relative,
  `.poster.html` suffix, query/hash stripped, URI-decoded), wired into `MarkdownImg` in
  `AssistantMessage.tsx`; the paragraph override now unwraps blocks for posters too. `isPosterFile` lives
  in `util/workspacePath.ts` beside `isDrawioFile`, and `FileViewer`'s `isPoster` delegates to it.
- **Links unchanged.** `[rules](posters/x.poster.html)` still opens the poster editor in the file viewer.

## Files

- `ui/src/util/workspacePath.ts` — `isPosterFile`.
- `ui/src/components/markdownPoster.tsx` — `isWorkspacePoster`, `workspacePosterPath`, `containsPoster`.
- `ui/src/components/PosterBlock.tsx` — the reply block (fetch, `readPage`, sandboxed scaled iframe,
  failure falls back to an "open in the viewer" link).
- `ui/src/components/AssistantMessage.tsx` — `img` and `p` component wiring.
- `ui/src/components/FileViewer.tsx` — `isPoster` delegates to `isPosterFile`.
