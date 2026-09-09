## Context

See `proposal.md` — Why. The mechanical facts the approach has to work with:

- `markdownToDocx(text)` takes text and nothing else. `docxExport.ts` holds the document's `path`
  but uses it only to name the download and to choose Markdown over plain text.
- The block walk (`blocksFrom`) is synchronous. Diagrams already solve this: `renderDiagrams(root)`
  walks the tree first, renders every ```mermaid fence, and hands the walk a `Map<Code, DiagramImage>`
  it can read synchronously. Referenced images have the same shape of problem and take the same
  shape of answer.
- `mermaidToImage.ts` already exports the pieces this needs: `svgDimensions`, `withExplicitSize`,
  `inlineStyles`, `rasterise`, and the `DiagramImage` type carrying `{ svg, png, width, height }`.
  `diagramBlock` in `markdownToDocx.ts` turns one of those into a `Paragraph` with an `ImageRun`.
- The viewer already resolves these references for display: `resolveRelativeHref(file.path, src)`
  then `rawFileUrl(serverUrl, path, token)`, both in `ui/src/util/workspacePath.ts`. `FileViewer`
  holds `serverUrl` and `token` as props (`""` and `null` when standalone and same-origin).
- `/files/raw` is confined server-side and already refuses a path outside the workspace.

## Goals / Non-Goals

**Goals**

- One resolution rule shared by the screen and the export, so the two cannot drift.
- One embedding rule shared by rendered diagrams and referenced vectors.
- A per-reference failure that costs the reader one picture, never the document.

**Non-Goals**

- Fetching anything off the application's origin, and therefore any support for `http(s):` or
  `data:` image references beyond keeping their alt text.
- Making the export work outside the browser, or without a server to serve `/files/raw`.
- Reading an image out of the rendered DOM. The export must work in split view and in raw view,
  where no `<img>` is mounted — the same reason D4 in the original change re-renders mermaid rather
  than lifting the on-screen SVG.

## Decisions

### D1 — Load referenced images in a pre-pass, keyed by node, like diagrams

`markdownToDocx` gains a second pre-pass beside `renderDiagrams`: walk the tree for `image` nodes,
resolve and fetch each one, and hand `blocksFrom` a `Map<Image, LoadedImage>`. The walk stays
synchronous and every asynchronous concern stays at the top.

*Alternative rejected — make the walk async.* `blocksFrom` recurses through lists, quotes, tables
and inline runs; threading `await` through all of it would rewrite the mapping to buy nothing, since
the set of images is knowable before the walk starts.

*Consequence:* the same file referenced twice is fetched once, because the pre-pass can deduplicate
by resolved path before fetching. It must still key the map by node, since two nodes may share a
path but not an alt text.

### D2 — Resolve with the viewer's own helpers, and pass origin and token in

`resolveRelativeHref` + `rawFileUrl` are what the `img` component uses; the export calls the same
two functions rather than reimplementing path arithmetic. That requires `serverUrl` and `token` to
reach the export: `FileViewer` → `DocxExportButton` → `downloadDocx` → `markdownToDocx`.

*Alternative rejected — resolve on the server, via a new "export bundle" route.* It would move the
resolution rule away from the one the viewer uses, which is precisely the drift this decision
exists to prevent, and it adds a route for something `/files/raw` already serves.

*Trade-off:* `buildDocx`'s signature grows. It is called by `downloadDocx` and by tests only, so an
options object (`{ path, serverUrl, token }`) keeps the call sites honest and lets a test pass a
stub loader.

### D3 — A vector reference goes through the diagram path; a raster is embedded as-is

For an SVG: `inlineStyles` (a figure written by `write_structure_figure` is already
attribute-painted, but a hand-written SVG in the workspace may not be, and the requirement that a
non-CSS reader sees the real picture applies to both), then `svgDimensions` + `withExplicitSize`,
then `rasterise` for the fallback — after which it is a `DiagramImage` and `diagramBlock` draws it.
For PNG/JPEG/GIF/WebP: the bytes go in as they are, with dimensions read by decoding the image once
(`loadImage`, already in `mermaidToImage.ts`).

*Alternative rejected — rasterise everything.* It would throw away the vector for the one case the
`structured-exchange` figure exists to serve.

*Alternative rejected — embed the SVG with no raster fallback.* `DiagramsAreEmbeddedAsVectorWithRasterFallback`
requires the fallback, and a reader without the Office extension would otherwise get a broken
picture.

### D4 — Which references are eligible is decided by the URL, not by the file

A reference is loadable when it has no scheme and does not start with `//` — the same test the
`img` component applies. Everything else (`http:`, `https:`, `data:`, protocol-relative) keeps its
alt text and is never fetched. That is what keeps `ExportIsOffline` true as amended, and it is
checkable without touching the network.

*Consequence:* a `data:` URI could technically be embedded without any request, but it stays out of
scope: it is not a workspace file, and admitting it widens what the export accepts from document
text.

### D5 — Failure is per-reference and silent in the document

A fetch that 404s or is refused, bytes that do not decode, an SVG that will not rasterise: each
falls back to the alt text for that one image. No dialog, no aborted export — `ExportIsBoundedAndReportsFailure`
already says a figure that cannot be produced is not a failure of the export, and the diagram path
already behaves this way.

## Risks / Trade-offs

- **Untrusted SVG from the workspace enters the package.** A workspace file is not necessarily one
  the agent wrote. → It is embedded as an image part, never as document XML, so it cannot close an
  element or inject a part; `TheExportIsAValidWordPackage` still holds. `inlineStyles` parses and
  re-serializes it, and a file that fails to parse or rasterise falls back to alt text (D5).
- **A document referencing many large images makes the export slow.** → The pre-pass deduplicates by
  resolved path, and `ExportIsBoundedAndReportsFailure` already governs the ceiling; the existing
  duration assertion in `e2e/docx-export.spec.ts` covers the shape.
- **The export now depends on the server being reachable.** A document exported while the connection
  is down loses its pictures rather than failing. → That is the specified degradation (D5), and the
  reader sees alt text rather than a corrupt file.
- **`buildDocx` gains parameters that only matter for Markdown.** → Grouped into one options object
  so the plain-text path ignores them.

## Migration Plan

None. No stored data, no format change, no server change: an export produced before this change and
one produced after both open in Word. The only observable difference is that a picture appears where
alt text used to.

## Open Questions

None.
