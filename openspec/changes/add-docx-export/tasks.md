## 1. Foundations

- [x] 1.1 Add `docx` and `katex` as direct dependencies of `ui/package.json` (`katex` is currently only transitive through `rehype-katex`); verify `npm install` succeeds and `npm run typecheck` still passes.
- [x] 1.2 Extract the private `save()` helper from `ui/src/presentations/tableExport.ts` into `ui/src/util/download.ts` and have `downloadCsv`/`downloadXlsx` call it; verify the existing `tableExport` tests pass unchanged.
- [x] 1.3 Create the `ui/src/export/` module skeleton (`docxExport.ts`, `markdownToDocx.ts`, `mathmlToOmml.ts`, `mermaidToImage.ts`) with a `downloadDocx(text, path)` entry that produces an empty valid package; verify a test unzips the result and finds `[Content_Types].xml` and `word/document.xml`.

## 2. Markdown structure

- [x] 2.1 Parse with `normalizeMathDelimiters` then `unified` + `remark-parse` + `remark-gfm` + `remark-math` (design D1); verify a test asserts `inlineMath` and `math` arrive as distinct node types from `$…$` and `$$…$$`.
- [x] 2.2 Map headings to Word heading styles; verify the `HeadingsBecomeWordHeadings` scenario — assert the paragraph style is the heading level and no `#` survives in the run text.
- [x] 2.3 Map bulleted and ordered lists including nesting, wiring `numbering.xml` through the library; verify the `NestedListsArePreserved` scenario — assert level and ordinal type for a bullet list containing an ordered one.
- [x] 2.4 Map GFM tables to Word tables with the header row marked; verify the `TableBecomesWordTable` scenario — assert row and cell counts match the source and the first row carries the header property.
- [x] 2.5 Map emphasis, strong, strikethrough, inline code and links to runs and hyperlinks; verify the `InlineFormattingSurvives` scenario — assert each run's property and that the hyperlink relationship resolves to its target.
- [x] 2.6 Map fenced and indented code blocks to monospace blocks with `xml:space="preserve"`; verify the `CodeBlockIsNotInterpreted` scenario — assert Markdown syntax inside the fence appears literally with indentation and line breaks intact.
- [x] 2.7 Map block quotes, thematic breaks, and carry any unmapped node as readable text; verify a test asserts an unmapped construct yields its text rather than being dropped or emitted as raw Markdown punctuation.

## 3. Equations

- [x] 3.1 Render each equation with `katex.renderToString(tex, { output: "mathml", displayMode })` and enumerate the emitted MathML element subset over a corpus of real formulas; verify the enumerated set is recorded in a test fixture so an unlisted element is a visible failure rather than a surprise.
- [x] 3.2 Implement the MathML→OMML transform against `docx`'s Math builders (`MathFraction`, `MathRadical`, `MathIntegral`, `MathSum`, `MathSuperScript`, `MathSubScript`, `MathSubSuperScript`, `MathLimitLower/Upper`, `MathRoundBrackets`, `MathRun`); verify element-by-element unit tests over the subset from 3.1.
- [x] 3.3 Keep the inline/display distinction — inline equations stay within their paragraph, display equations become their own block; verify the `InlineEquationIsNative` and `DisplayEquationIsItsOwnBlock` scenarios, asserting the surrounding paragraph text is unbroken in the inline case.
- [x] 3.4 Fall back to LaTeX source text for any equation outside the covered subset, without failing the export; verify the `UntranslatableEquationFallsBackToSource` scenario with an element deliberately outside the set, asserting the rest of the document is unaffected and the package still opens.
- [x] 3.5 Diff the transform's output against `mathml2omml` as a test-only oracle on the 3.1 corpus (design D3 — the package is LGPL, so it is a dev-only comparison and must not be bundled); verify the comparison runs and any divergence is either fixed or recorded with a reason.

## 4. Diagrams

- [x] 4.1 Render mermaid fences for the export via the `loadMermaid` pattern with `htmlLabels: false` (design D4 — `foreignObject` does not draw through an `<img>` and labels come out blank otherwise); verify a test asserts the produced SVG contains `<text>` labels and no `foreignObject`.
- [x] 4.2 Substitute concrete `viewBox` dimensions for mermaid's `width="100%"` using the `naturalWidth` arithmetic, then rasterise via `Image` → canvas → `toBlob("image/png")` at a raised pixel ratio; verify a test asserts the PNG has non-zero intrinsic dimensions matching the diagram's aspect ratio.
- [x] 4.3 Embed each diagram through `SvgMediaOptions` (`{ type: "svg", data, fallback }`); verify the `FallbackImageIsPresent` scenario — unzip the package and assert both the SVG and PNG parts exist and the picture's `r:embed` refers to the raster.
- [x] 4.4 Compute physical size as px → pt at 96 dpi → EMU at 12700 EMU/pt, clamped to 5 943 600 EMU text width with aspect ratio preserved; verify the `DiagramIsSizedForThePage` scenario with an over-wide diagram.
- [x] 4.5 Fall back to a monospace source block when a diagram cannot render or rasterise; verify the `UnrenderableDiagramFallsBackToSource` scenario with an invalid diagram, asserting the export succeeds and no relationship points at a missing part.
- [x] 4.6 Guard export-time mermaid configuration as a critical section that restores the previous configuration afterwards (design risk — `initialize()` is global module state shared with the on-screen renderer); verify a test exports while a diagram is mounted and asserts the on-screen mermaid configuration is unchanged after.

## 5. Plain text and package validity

- [x] 5.1 Export a non-Markdown text file as monospace paragraphs preserving lines and leading whitespace, bypassing the Markdown pipeline entirely; verify the `TextFileKeepsItsLines` and `TextIsNotInterpreted` scenarios, asserting `#`, pipes and `$` stay literal.
- [x] 5.2 Escape XML-significant characters in all document-derived text; verify the `DocumentTextCannotBreakThePackage` scenario with angle brackets, ampersands, quotes and XML-like markup, asserting the text is literal and the package structure is intact.
- [x] 5.3 Write a package validator used by the export tests that unzips the output and asserts every declared relationship resolves to a present part and every part has a declared content type; verify the `EveryRelationshipResolves` scenario on a document containing images, hyperlinks and equations.

## 6. Viewer integration

- [x] 6.1 Add the export action to the `FileViewer` toolbar, reaching the module only through `await import("../export/docxExport")` inside the handler; verify a test asserts the export module is not in the main chunk after `npm run build`, and record the export chunk's size.
- [x] 6.2 Gate the affordance — offered for any loaded text file in any view mode, independent of the writable zone, and not for images, PDFs, unloaded files or the git-diff view; verify the `WordDownloadOfferedForText`, `WordDownloadIgnoresTheWritableZone` and `NoWordDownloadForBinaryOrDiff` scenarios.
- [x] 6.3 Name the download from the source path, replacing the extension; verify the `ExportNamesTheFileAfterItsSource` scenario including a file with no extension and a name containing dots.
- [x] 6.4 Export from the rendered text — the unsaved draft when an edit buffer is open — without saving, closing, or changing the view mode; verify the `UnsavedDraftIsExported` and `ExportLeavesTheViewerAlone` scenarios.
- [x] 6.5 Show in-progress state and report failure with its reason, downloading nothing on failure; verify the `ExportInProgressIsVisible` and `FailedExportSaysSo` scenarios by forcing the writer to reject.

## 7. Verification in the running app

Unit tests are necessary and not sufficient here (CLAUDE.md — UI and UX changes). Rebuild `web`, then `@pi-outpost/embed`, then `build:e2e-host` before driving the bench, since it serves `dist/`.

- [x] 7.1 Drive the real export in the running app via `npm run bench` on a document with headings, nested lists, a table, inline and display equations and a mermaid diagram; verify by reading back the downloaded bytes — unzip and assert the parts, not by screenshot.
- [x] 7.2 Open that exported file in real Word; verify the `WordOpensItWithoutRepair`, `EquationIsEditableInWord` and `DiagramIsVectorInWord` scenarios by observation — no repair prompt, the equation selects as an equation object, the diagram stays sharp when enlarged.
- [x] 7.3 Open the same file in a reader without SVG-extension support (LibreOffice or Google Docs); verify the `OtherReadersSeeThePicture` scenario — the raster is displayed rather than a broken image.
- [x] 7.4 Confirm no network request is made during an export; verify the `ExportIsOffline` scenario by recording network activity across an export in the running app.
- [x] 7.5 Adversarial pass, past the happy path (CLAUDE.md — do not stop at the happy path): double-click the export button, export while a reply is streaming, export then immediately switch file or session, export a file deleted from disk mid-run, spam mode switches during an export, export a very large document; verify by reading back the DOM and downloads after each burst and reporting what broke, not that it works.
- [x] 7.6 Verify the `LargeDocumentDoesNotHangTheApplication` scenario in the running app — the interface stays responsive and either completes or reports why it stopped.

## 8. Closing out

- [x] 8.1 Write `openspec/changes/add-docx-export/scenario-coverage.md` covering all 38 declared scenarios (28 in `docx-export`, 10 in `file`), each classified `covered`/`partial`/`uncovered` with test file and test name; verify `npm run check:scenarios` passes.
- [x] 8.2 Read the cited assertions rather than the test names (CLAUDE.md — a scenario is covered only if its contract would fail the test if broken); verify by confirming each Word-observable scenario cites either a package-level assertion or a recorded 7.2/7.3 observation, never a screenshot.
- [ ] 8.3 Run `npm run lint`, `npm run typecheck`, the `ui` suite and `npm run test:e2e`; verify all pass.
- [x] 8.4 Documentation impact pass (CLAUDE.md): search `README.md`, `docs/` and package READMEs for viewer and export claims, update what the new action makes stale, and record the files updated — or `None` with a reason — in the PR description.
- [x] 8.5 Run `openspec validate add-docx-export --strict` and `check_spec_drift`; verify both pass before opening the PR.
