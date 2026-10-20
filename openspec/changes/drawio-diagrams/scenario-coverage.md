# Scenario coverage

OpenLore's MCP server was not connected in this session; targeted inspection of
`FileViewer.tsx`, `HtmlPageFrame.tsx`, `piOutpostTools.ts`, `sandbox.ts`, `index.ts`, the
office XML scanner and jgraph's GraphViewer source (jgraph/drawio v32.5.5) stood in.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/drawio-diagrams`. Every
test below carries an `openlore: scenario=<name> spec=drawio-diagrams` annotation.

The checker was also run over all 106 of draw.io's own templates (v32.5.5): every one
reads, none reports an error; the rules were tightened until the warnings left were
deliberate overlaps (venn, cycles, timelines) and three shapes outside a lane.

The running app was driven (`scripts/probes/drawio-server.mts`, standalone app — the
bench's host page is a widget): a jgraph template drawn with its labels; a two-page file's
second page reached from the viewer's toolbar, zoom used; its remote image and font refused
by the frame's policy with no response from any outside host; a non-diagram's reason and
source; dark mode (draw.io's own adaptive colours, dark toolbar); a file saved from a
terminal redrawn on the page the reader was on; the split mode redrawing typed text in the
same frame, and a broken draft saying why; six files opened in quick succession, the last
one shown; a file deleted under the app leaving the tree. Found and fixed on the way: the
toolbar drawn outside the frame (`toolbar-position: inline`), dark mode passed as a boolean
the viewer ignores, the page reset on redraw, and `drawio_check` missing from the sandboxed
and unsandboxed sessions (it was registered for the RPC child only).

| Scenario | Status | Test file and name |
|---|---|---|
| ADrawioFileIsDrawn | covered | `e2e/drawio-viewer.spec.ts`: `ADrawioFileIsDrawn: …` — a jgraph-written file's labels in the drawn SVG, rendered mode pressed, source one click away, no page error; `ui/src/components/FileViewer.drawio.test.tsx`: `ADrawioFileIsDrawn: …` — the frame, the text posted, the three modes; `ui/src/components/DrawioFrame.test.tsx`: `ADrawioFileIsDrawn: …` — posted only after READY from its own frame. |
| EveryPageIsReachable | covered | `e2e/drawio-viewer.spec.ts`: `EveryPageIsReachable: …` — the viewer's "Next Page" moves from the first page's labels to the second's; `ui/src/components/DrawioFrame.test.tsx`: `asks the viewer for its own dark mode …` — the `pages` toolbar at its default place (no `toolbar-position`). |
| TheDraftIsDrawnBesideIt | covered | `e2e/drawio-viewer.spec.ts`: `TheDraftIsDrawnBesideIt: …` — typed label drawn, same frame element; `ui/src/components/DrawioFrame.test.tsx`: `TheDraftIsDrawnBesideIt: …` — new text posted to the same frame. |
| AnUnreadableDiagramSaysWhy | covered | `e2e/drawio-viewer.spec.ts`: `AnUnreadableDiagramSaysWhy: …` — the reason and the source in the browser; `ui/src/components/DrawioFrame.test.tsx`: `AnUnreadableDiagramSaysWhy: …` — alert and fallback, the frame collapsed but laid out, both gone on the next drawing. |
| TheViewerNeverReachesTheNetwork | covered | `e2e/drawio-viewer.spec.ts`: `TheViewerNeverReachesTheNetwork: …` — the remote image request fails, no response from any host but the server, frame origin `"null"`, parent document and storage blocked; `ui/src/components/DrawioFrame.test.tsx`: `TheViewerNeverReachesTheNetwork: …` (×2) — the exact directives, nothing else allowed, the policy before any script, no diagrams.net default left, `sandbox="allow-scripts"`. |
| OpenInDrawio | covered | `ui/src/components/FileViewer.drawio.test.tsx`: `OpenInDrawio: …` — the button calls `onOpenNative` with the path; `App.tsx` passes the existing `openNative` (the `open_native` request, covered by `server/test/revealNativeWire.test.mjs`). |
| TheDiagramFollowsTheFile | covered | `ui/src/components/FileViewer.drawio.test.tsx`: `TheDiagramFollowsTheFile: …` — a re-read file is posted to the same frame. Also observed in the running app (a save from a terminal, page kept). |
| TheCheckerReportsDefects | covered | `server/test/drawio.test.ts`: `TheCheckerReportsDefects: …` — eight defects, each an error naming its cell, the verdict "would not open as intended". |
| TheCheckerWarnsAboutLayout | covered | `server/test/drawio.test.ts`: `TheCheckerWarnsAboutLayout: …` — exactly the overlapping pair and the shape outside its lane; `deliberate stacking is not an overlap …` — containment, unlabelled shapes, a sliver and a group stay silent. |
| CompressedPagesAreRead | covered | `server/test/drawio.test.ts`: `CompressedPagesAreRead: …` (×2) — a compressed page reports exactly what its plain twin does; two files draw.io itself wrote read clean with exact counts. |
| ACleanDiagramPasses | covered | `server/test/drawio.test.ts`: `ACleanDiagramPasses: …` — no issue, counts, the exact verdict sentence; `the skill's own examples, assembled, pass the check`. |
| TheCheckerStaysInTheSandbox | covered | `server/test/drawio.test.ts`: `TheCheckerStaysInTheSandbox: …` — absolute and `..` paths outside refused, an HTML file and a missing one refused with the reason; registration in the sandboxed session asserted by `server/test/sandbox-tools.test.ts`. |
