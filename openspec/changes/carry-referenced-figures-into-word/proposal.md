## Why

The agent can write a figure to a path *"so that the agent can reference that figure from a document
it is writing"* (`structured-exchange` — `TheAgentCanWriteAFigureToAPath`), and that figure is made
self-contained precisely so it can travel (`AFigureLeavesAsOneFile`). A reader who then takes that
document away as Word loses every one of those figures: they arrive as their alt text, and the
`.docx` contains no picture at all.

The gap is in the capability boundary rather than in the code. `docx-export` promises a document
that keeps "headings, lists, tables, equations and diagrams", but has no requirement about a
*referenced* image, and its `ExportIsOffline` requirement — "The document's own text is the only
input" — forbids the only possible implementation. So a report written by the agent, with the
figures the agent was given a tool to produce, cannot be sent to someone who does not open a
repository without being rebuilt by hand, which is the reason the export exists.

Observed on the bench: exporting `report.md` (which references `figures/whole.svg` and
`figures/power-only.svg`) and a `beside.md` seeded with an SVG in its own directory both produce a
package with no `word/media/` part. Both figures come out as the strings "The whole architecture"
and "Power only". The directory is not what decides it — no referenced image is ever carried.

## What Changes

- A Markdown image whose target is a workspace file is embedded in the export as a picture, instead
  of degrading to its alt text. An SVG is embedded as a vector with a raster fallback, exactly as a
  rendered diagram already is; a raster format travels as itself.
- The reference is resolved against the exported document's own directory, so a figure in a
  subdirectory (`figures/whole.svg`), beside the document (`diagram.svg`), or above it
  (`../shared/figure.svg`) all resolve the way the viewer already resolves them on screen.
- `ExportIsOffline` is amended to say what its own test already asserts: nothing leaves the origin
  that served the application. The inputs become the document's text **and the workspace files it
  references**, rather than the text alone. An image referenced by an absolute URL is not fetched,
  and keeps its alt text — that is the part of the requirement that has to stay.
- A reference that cannot be loaded — a deleted file, a refused path, an unreadable image — degrades
  to its alt text, and MUST NOT fail the export or leave a relationship pointing at a part the
  package does not contain. This is the rule diagrams already follow.
- The export learns the document's path. `downloadDocx` already receives it (to name the download);
  it is not passed through to the Markdown mapping, and now must be.

Not in scope: embedding an image from the network or from a `data:` URI, exporting a document the
viewer is not showing, and any change to how the viewer renders a figure on screen.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `docx-export`: gains a requirement that a referenced image is carried as a picture, with the
  vector-plus-raster rule diagrams already carry, resolution relative to the document, and a local
  degradation to alt text for a reference that cannot be loaded. `ExportIsOffline` is amended so the
  workspace files a document references are inputs, while off-origin fetching stays forbidden.

## Impact

- `ui/src/export/docxExport.ts` — `documentChildren` must pass the document's path, and the export
  needs the server origin and token to reach `/files/raw` (the viewer holds both; `buildDocx`
  currently takes neither).
- `ui/src/export/markdownToDocx.ts` — the `image` case (currently alt text at line 128), plus a
  loading pass alongside `renderDiagrams`, so that a picture's bytes are in hand before the
  synchronous block walk runs.
- `ui/src/export/mermaidToImage.ts` — the SVG-with-raster embedding and the sizing arithmetic exist
  here for diagrams; a referenced SVG needs the same treatment and should reuse it rather than grow
  a second copy.
- `ui/src/components/DocxExportButton.tsx` and `ui/src/components/FileViewer.tsx` — the origin and
  token reach the button, which passes them on.
- `ui/src/util/workspacePath.ts` — `resolveRelativeHref` and `rawFileUrl` are what the viewer's
  `img` component already uses; the export uses the same two, so on-screen and exported references
  cannot drift apart.
- `e2e/docx-export.spec.ts` — the offline test's assertion stays as it is; the fixture grows a
  document that references a figure on disk.
- No server change: `/files/raw` already serves workspace files and already refuses a path outside
  the confinement.
