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

*Trade-off:* `buildDocx`'s signature grows. The path stays where it already was —
`buildDocx(text, path, options)` — and the options object carries only what is new
(`{ serverUrl, token }`), which `documentChildren` folds back together as
`markdownToDocx(text, { ...options, path })`. Every existing call site and test keeps working, and
the plain-text path ignores the options entirely.

### D3 — A vector reference goes through the diagram path; a raster is embedded as-is

For an SVG, the order `renderDiagram` already uses, for the reasons it already has: size it
(`svgDimensions` + `withExplicitSize`), rasterise the *styled* original — a browser applies the CSS,
so the fallback is right either way — and run `inlineStyles` over the vector alone, which is the
copy that travels to readers that do not run a stylesheet (a figure written by
`write_structure_figure` is already attribute-painted; a hand-written workspace SVG may not be, and
the requirement applies to both). After that it is a `DiagramImage` and the diagram's own picture
run draws it. A workspace SVG that states no viewBox but does state a root `width` and `height`
draws perfectly well in the viewer, so `svgSize` reads those rather than refusing a picture the
reader can see.

For a raster: the bytes go in as they are, with the format and pixel size read from the file's own
header — PNG's IHDR, a JPEG's frame header, the GIF and BMP headers. Read rather than decoded,
which is the one departure from what this decision first said. Decoding through `loadImage` needs a
browser, and the export's other picture code already cannot be tested in jsdom for exactly that
reason; a header read is a pure function over bytes, so the raster path is *real* in the unit tests
instead of mocked. It also costs nothing at export time.

*Consequence:* the formats that can travel are the four the writer has part types for — PNG, JPEG,
GIF and BMP. A WebP or an AVIF is an image the viewer draws happily and the package has no part it
could become, so it degrades to its alt text under D5 rather than producing a part no reader could
open. The requirement says so explicitly.

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
  reader sees alt text rather than a corrupt file. Observed on the bench: with the server killed
  underneath a loaded page, the export succeeds and every figure arrives as its alt text.
- **With the server unreachable *before* the export has ever run, it fails outright.** The button
  reports "export failed" rather than degrading. → Not the reference path: the whole export module
  is fetched by `import()` on first use, so with nothing served there is no writer either, and this
  is how the export behaved before this change. Once the chunk is loaded, the degradation above is
  what happens. Worth knowing when reading a failure report; not worth pre-loading a document
  writer into every session to fix.
- **`buildDocx` gains parameters that only matter for Markdown.** → Grouped into one options object
  so the plain-text path ignores them.

## Migration Plan

None. No stored data, no format change, no server change: an export produced before this change and
one produced after both open in Word. The only observable difference is that a picture appears where
alt text used to.

## Open Questions

None.
