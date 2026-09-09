## 1. Carry the document's location into the export

- [ ] 1.1 Give `buildDocx`/`downloadDocx` an options object carrying `path`, `serverUrl` and `token` (D2), leaving the plain-text path untouched; verify the existing `ui/src/export/docxExport.test.ts` still passes and a new case asserts a Markdown export with no options still produces a valid package.
- [ ] 1.2 Pass `serverUrl` and `token` from `FileViewer` through `DocxExportButton` into `downloadDocx`; verify a test renders the button with a server URL and token and asserts both reach the export call.

## 2. Resolve and load a referenced image

- [ ] 2.1 Add a loader that decides eligibility from the URL alone — no scheme, not protocol-relative (D4) — and otherwise reports the reference as not loadable; verify unit tests cover a relative path, a subdirectory path, a `../` path, a workspace-absolute path, `https://…`, `data:…` and `//host/x.svg`.
- [ ] 2.2 Resolve an eligible reference with `resolveRelativeHref(path, src)` and fetch it through `rawFileUrl(serverUrl, resolved, token)` (D2); verify a test with a stubbed `fetch` asserts the requested URL matches what the viewer's `img` builds for the same document and reference — this is the `WhatTheViewerShowsIsWhatTheExportCarries` seam.
- [ ] 2.3 Deduplicate by resolved path within one export while keying results by node (D1); verify a test with a document referencing the same file twice with different alt texts asserts one fetch and two pictures.

## 3. Turn loaded bytes into a picture

- [ ] 3.1 For an SVG payload, run `inlineStyles` → `svgDimensions` → `withExplicitSize` → `rasterise` to produce a `DiagramImage`, and embed it through the existing `diagramBlock` (D3); verify the `AReferencedVectorIsVectorInWord` scenario by unzipping an export of a document referencing a figure and asserting one `.svg` part, one `.png` part and an `svgBlip` extension on the picture.
- [ ] 3.2 For a raster payload, embed the bytes as their own format with dimensions read by decoding once (D3); verify a test exports a document referencing a PNG and asserts the part is that PNG, byte for byte, with a physical size derived from its pixels.
- [ ] 3.3 Constrain every embedded picture to the text width, keeping its aspect ratio, reusing the diagram sizing arithmetic; verify a test exports a reference far wider than the page and asserts the drawn width is the text width and the ratio is unchanged.

## 4. Degrade rather than fail

- [ ] 4.1 Fall back to the reference's alt text when the fetch fails, the payload does not decode, or rasterisation throws (D5); verify tests for a 404, a refused path and a payload that is not an image, each asserting the alt text appears, the export succeeds and the rest of the document is intact.
- [ ] 4.2 Run the package validator over an export whose references all failed; verify the `AMissingReferenceFallsBackToItsText` scenario — every declared relationship resolves to a present part and every part has a declared content type.

## 5. Prove the capability end to end

- [ ] 5.1 Extend the e2e fixture with a document referencing a figure beside it, one in a subdirectory and one in a parent directory; verify the `AFigureBesideTheDocumentIsCarried` and `AFigureInAnotherDirectoryIsCarried` scenarios by unzipping the download and asserting three picture parts.
- [ ] 5.2 Re-run `e2e/docx-export.spec.ts`'s "exporting reaches the network for nothing" against that fixture; verify the amended `ExportIsOffline` scenario — requests are made, and none leaves the harness origin.
- [ ] 5.3 Verify `AnAbsoluteUrlIsNotFetched` by exporting a document referencing `https://example.com/x.png` and asserting no request for it and alt text in the document.
- [ ] 5.4 Open one export in real Word and one in a reader without SVG-extension support; record the result in the change's verification notes as `word-verification.md` did for the original export change.

## 6. Land it

- [ ] 6.1 Drive the export in the running app on the bench (`report.md`, which references `figures/whole.svg` and `figures/power-only.svg`): export it, unzip the download, and confirm both figures are picture parts rather than alt text — the observation that opened this change.
- [ ] 6.2 Monkey-test around it: export while the file is being edited, export twice rapidly, export after deleting a referenced figure from disk, and export with the server stopped; verify each either carries the picture or falls back to alt text, and that none produces a corrupt package or an unhandled rejection.
- [ ] 6.3 Write `scenario-coverage.md` for this change and run `npm run check:scenarios`; verify every scenario in the delta is listed `covered` with the test that would fail if the behavior broke.
