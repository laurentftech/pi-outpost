# Scenario coverage

OpenLore's `orient` answered but its daemon was unavailable for most of this session;
targeted inspection of `DrawioFrame.tsx`, `drawioPage.ts`, `FileViewer.tsx`,
`AssistantMessage.tsx`, `useAgent.ts`, `EnlargedView.tsx`, `Mermaid.tsx`, the conversation
exports, `server/src/index.ts` (read and list handlers) and `server/src/fileWatcher.ts`
stood in, as did jgraph's viewer bundle itself (v32.5.5), read in the running frame.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/drawio-in-conversation`.
Every test below carries an `openlore: scenario=<name> spec=drawio-diagrams` annotation.

The running app was driven three ways: the e2e spec (`e2e/drawio-conversation.spec.ts`, a
fake-RPC transcript whose reply references a two-page `.drawio` in its own workspace,
every gesture a real mouse or keyboard event, the file read back from disk); the dev app
on a real agent-written diagram (touch-up, save, conflict, deletion under a touch-up,
double-clicked save, a label being typed when leaving); and one live turn with
`openai/gpt-5.6-luna`, which checked the file it wrote and referenced it in its reply,
where it was drawn with its controls.

Found in the running app and fixed, none caught by a unit suite: the graph container's
padding shifted every mxGraph hit by 8 px (connection points never answered, wires missed
by a few pixels); mxGraph's `pointerdown` default suppressed the `mousedown` the keyboard
hand-off listened for, and a headless browser would not move focus into the frame without
the parent; the drawing area did not grow, so a box pushed past it vanished; a diagram
wider than the frame ran off its edge behind a hidden scrollbar; a box dropped off the
grid; a file in a reply, or opened from it, was never followed, because only listed
directories were watched; a label being typed did not count as unsaved.

| Scenario | Status | Evidence |
| --- | --- | --- |
| AReferencedDiagramIsDrawnInTheReply | covered | `e2e/drawio-conversation.spec.ts`: `AReferencedDiagramIsDrawnInTheReply: …` — the reply's frame is `allow-scripts`, its labels drawn, its controls exactly enlarge / download SVG / download .drawio / open, no `<img>`, not inside a `<p>`, no page error; `ui/src/components/DrawioBlock.test.tsx` and `ui/src/components/AssistantMessage.test.tsx`: `AReferencedDiagramIsDrawnInTheReply: …` — the file read through `fileIo` (path URL-decoded), RENDER posted, no touch-up in a reply. |
| AMissingDiagramSaysSo | covered | `e2e/drawio-conversation.spec.ts`: `AMissingDiagramSaysSo: …` — the gone file named, one frame only; `ui/src/components/DrawioBlock.test.tsx`: `AMissingDiagramSaysSo: …` (×2) — a refused read names the file with no frame and no `<img>`; an unreadable text shows the viewer's reason and names the file. |
| TheReplyFollowsTheFile | covered | `e2e/drawio-conversation.spec.ts`: `TheReplyFollowsTheFile: …` — a write to disk is redrawn in the reply; `ui/src/components/DrawioBlock.test.tsx`: `TheReplyFollowsTheFile: …` — a change notification re-reads and re-posts; `ui/src/useAgent.test.ts`: `calls a path's listeners when it, or its directory, changes …`; `server/test/file-watching.test.mjs`: `follows a file that was read, though nobody listed its folder`. |
| AnExportCarriesALink | covered | `ui/src/export/conversationHtml.test.ts`: `AnExportCarriesALink: …` — an `<a>` naming the file, no `<img>`, no picture looked up; `ui/src/export/referencedImages.test.ts`: `AnExportCarriesALink: …` — the Word package has no media part, the label in the text, an external relationship to the file, and nothing fetched. |
| EnlargeShowsTheDiagramAtFullSize | covered | `e2e/drawio-conversation.spec.ts`: `EnlargeShowsTheDiagramAtFullSize: …` — over 80 % of the viewport, labels drawn, both downloads, Escape returns to the reply; `ui/src/components/DrawioBlock.test.tsx`: `EnlargeShowsTheDiagramAtFullSize: …` — dialog, isolated frame, downloads and touch-up, Escape closes. |
| DownloadSvgSavesThePageShown | covered | `e2e/drawio-conversation.spec.ts`: `DownloadSvgSavesThePageShown: …` — `services-Services.svg`, an XML declaration, each label also as plain `<text>`; `ui/src/components/DrawioBlock.test.tsx`: `DownloadSvgSavesThePageShown: …` — the second page's export named after file and page. Word desktop not available here: an exported SVG was sent to the user for that check. |
| DownloadDrawioSavesTheFile | covered | `e2e/drawio-conversation.spec.ts`: `DownloadSvgSavesThePageShown: …` (second half) — `services.drawio`, byte for byte the file; `ui/src/components/DrawioBlock.test.tsx`: `DownloadDrawioSavesTheFile: …`. |
| OpenTheFileFromTheReply | covered | `e2e/drawio-conversation.spec.ts`: `OpenTheFileFromTheReply: …` — the file viewer opens it, drawn; `ui/src/components/DrawioBlock.test.tsx`: `OpenTheFileFromTheReply: …` — `onOpenFile` with the path. |
| ShapesMoveAndConnectorsFollow | covered | `e2e/drawio-conversation.spec.ts`: `ShapesMoveAndConnectorsFollow: …` — a real drag, saved on the grid, the wire still A→B; `ui/src/components/DrawioBlock.test.tsx`: `SavingKeepsTheRestOfTheFile: …` — the frame's page spliced into the file read at the start. |
| AConnectorIsReattached | covered | `e2e/drawio-conversation.spec.ts`: `AConnectorIsReattached: …` — the wire selected on its path, its end handle dragged onto Charlie, saved `target="c"` under id `a-b`. |
| ALabelIsEditedInPlace | covered | `e2e/drawio-conversation.spec.ts`: `AConnectorIsReattached: …` (second half) — double-click, typed, confirmed by clicking away, saved `value="Bravo v2"`. The in-place editor is draw.io's rich one, positioned on the shape (the `.mxCellEditor` rule asserted in `DrawioFrame.test.tsx`). |
| UndoRestoresTheDiagram | covered | `e2e/drawio-conversation.spec.ts`: `ShapesMoveAndConnectorsFollow: …` — ⌘/Ctrl+Z puts the shape back where it was, redo brings the move back; `ui/src/components/DrawioBlock.test.tsx`: `UndoRestoresTheDiagram: …` — the controls enabled as the frame reports. |
| ReadingIsReadOnly | covered | `e2e/drawio-conversation.spec.ts`: `ReadingIsReadOnly: …` — a real drag outside touch-up moves nothing, the file untouched; `ui/src/components/DrawioBlock.test.tsx` and `DrawioFrame.test.tsx`: `ReadingIsReadOnly: …` — EDIT is posted only once touch-up is asked for. |
| SavingKeepsTheRestOfTheFile | covered | `e2e/drawio-conversation.spec.ts`: `ShapesMoveAndConnectorsFollow: …` — the second page byte for byte, `pageWidth` kept, an untouched cell unchanged; `ui/src/util/drawioSplice.test.ts` — other pages byte-identical, a compressed page written plain, ids and model attributes kept, CRLF kept; `ui/src/components/DrawioBlock.test.tsx`: `SavingKeepsTheRestOfTheFile: …`. |
| AFileChangedOnDiskIsNotOverwritten | covered | `e2e/drawio-conversation.spec.ts`: `AFileChangedOnDiskIsNotOverwritten: …` — a write underneath, the save refused with the message, the file on disk the other writer's; `ui/src/components/DrawioBlock.test.tsx`: `AFileChangedOnDiskIsNotOverwritten: …`; `ui/src/useAgent.test.ts`: `rejects a refused write with the server's reason …`. Also in the dev app: a file removed under a touch-up is not recreated. |
| UnsavedTouchUpIsNotLostSilently | covered | `e2e/drawio-conversation.spec.ts`: `AFileChangedOnDiskIsNotOverwritten: …` (dismissed then accepted) and `Escape while touching up is "done": …`; `ui/src/components/DrawioBlock.test.tsx`: `UnsavedTouchUpIsNotLostSilently: …` (×2) and the Escape test; `ui/src/components/FileViewer.drawio.test.tsx`: `UnsavedTouchUpIsNotLostSilently: …` — Escape and a mode change ask, `onDirtyChange(true)`. |
| TheGuidanceAsksToShowTheDiagram | covered | `server/test/drawio.test.ts`: `TheGuidanceAsksToShowTheDiagram: …` — the tool's guideline and the skill's step 4 with the picture syntax. Observed live: the agent referenced the checked file in its reply. |
