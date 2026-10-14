# Scenario coverage

OpenLore orient was run before implementation. Its graph index was unavailable;
targeted rg inspection identified Mermaid, StructuredExchangeView, EnlargedView and
the existing portable SVG exporter. The requested consistent controls and download
were absent from the implementation and are recorded in the delta. The bottom-left
fixed footer follows the user's correction during the running-app review.

The main and delta scenarios were enumerated with `rg '^#### Scenario:' openspec/`.
The table covers all delta scenarios and the applicable existing Mermaid orientation
contracts. Structured graph filtering/layout, tables and document editing are unchanged.

| Scenario | Status | Test file and name |
|---|---|---|
| MermaidActionsMatchOtherDiagrams | covered | `e2e/mermaid-download.spec.ts`: `MermaidActionsMatchOtherDiagrams: visible actions and a portable SVG of the turned diagram`; visible underline action below SVG without hover, plus download in full-size view. |
| DownloadTheShownMermaid | covered | `ui/src/components/Mermaid.download.test.tsx`: `DownloadTheShownMermaid: exports the orientation shown and keeps authored source available`; `e2e/mermaid-download.spec.ts`: same browser test checks the downloaded file's labels, dimensions, landscape viewBox and absence of foreignObject/style. |
| EnlargedDiagramActionsStayFixed | covered | `e2e/mermaid-download.spec.ts`: same browser test scrolls the content to its horizontal/vertical limit, asserts a real horizontal scroll and unchanged button bounds at the footer's left edge, then downloads and closes with Escape. |
| FailedMermaidDownloadCanBeRetried | covered | `ui/src/components/Mermaid.download.test.tsx`: `FailedMermaidDownloadCanBeRetried: reports failure, enables retry and keeps the diagram`. |
| AMermaidDownloadCannotOutliveItsSource | covered | `ui/src/components/Mermaid.download.test.tsx`: `AMermaidDownloadCannotOutliveItsSource: prevents duplicate downloads and drops a replaced source`; pending promise, double click, source replacement, completion and no anchor click. |
| AWideDiagramIsTurned | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `draws it the other way when the authored direction does not fit`; `e2e/embed.spec.ts`: `a Mermaid diagram too wide to read is turned, says so, and keeps its source`. |
| ASmallDiagramIsLeftAlone | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `keeps the authored direction when what it draws fits`. |
| TheReaderTurnsADiagram | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `draws the direction the reader picks, without measuring anything`; browser test above turns and rapidly toggles twice before downloading. |
| TheReaderOverridesTheAutomaticChoice | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `overrides a diagram the system turned, and stays overridden`. |
| AnUnreadableAuthoredDirectionIsOverridden | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `draws it the other way when the authored direction does not fit`. |
| AReadableAuthoredDirectionIsKept | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `keeps the authored direction when what it draws fits`. |
| AnOverriddenDiagramSaysSo | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `says on the block that it is not drawn the way its source asks`. |
| TheAuthoredSourceIsWhatTheReaderGets | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `still shows and copies the source the agent wrote`; new download test reads back the exact original text after turning/export. |
| ASequenceOffersNoOrientation | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `draws a sequence exactly as written, however wide it is`. |
| ANotationWithNoDirectionIsLeftAlone | covered | `ui/src/components/Mermaid.orientation.test.tsx`: `draws a sequence exactly as written, however wide it is`; parser inventory in `ui/src/components/mermaidDirection.test.ts`. |
| TheExportIsWhatIsShown | covered | `e2e/mermaid-download.spec.ts`: downloaded landscape SVG after the real diagram is turned landscape; unit test verifies exact oriented source handed to the exporter. |

The existing document/export and Office renderer tests additionally check real SVG and
raster labels, standalone appearance, parse failures and recovery after a timeout.
Browser checks use the built app and widget. A temporary reduced setup launches only
the diagram backend and host; the normal global setup also launches unrelated services.
