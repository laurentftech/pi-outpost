# Scenario coverage

Inventory: `rg '^#### Scenario:' openspec/changes/poster-drawio-pictures/` lists ten scenarios; all ten are below. OpenLore's `orient` was not usable in this container (its `npx` install output buried the answer), so the surface was found with targeted `rg` over `posters/src`, `ui/src/components/PosterFrame.tsx`, `DrawioFrame.tsx`, `ui/src/util/drawioPage.ts`, `ui/src/fileIo.ts` and `useAgent.ts`. The existing poster and draw.io scenarios keep their tests, all passing.

| Applicable scenario | Status | Tests and assertions |
|---|---|---|
| TheProjectsDiagramsAreOffered | covered | `ui/src/components/FileViewer.poster.test.tsx` "TheProjectsDiagramsAreOffered": DRAWIO_LIST answers each `.drawio`/`.dio` file (not directories, nor a Markdown file whose name holds ".drawio") as a path from the poster's directory with its pages, a broken one with none. `e2e/poster-files.spec.ts` "Insert → draw.io diagram": the running editor's list holds `../diagrams/flow.drawio` and both pages of `two-pages.drawio`. |
| ADiagramGoesIntoTheSelectedFrame | covered | e2e, same test: the example's empty photo frame selected, the chosen diagram fills it (`data-drawio` set, an SVG picture), and the status says it was placed. |
| ADiagramGoesOntoThePage | covered | e2e, same test: nothing selected, one `img[data-drawio]` with `data-drawio-page="Context"` appears, its box in the picture's own proportions (within 0.05). |
| AnUnreadableDiagramSaysWhy | covered | Unit "AnUnreadableDiagramSaysWhy": a non-diagram answers "it is not a draw.io diagram (its root is <html>)", a non-`.drawio` path is refused unread, and nothing is drawn. e2e: choosing `broken.drawio` shows "could not be drawn: it is not a draw.io diagram" and adds no picture. |
| AnAgentsFrameIsFilledOnOpen | covered | e2e "AnAgentsFrameIsFilledOnOpen…": a poster written on disk with two empty frames; on open both hold SVG pictures of the right pages, the picture decodes in the canvas, Save is enabled, and after saving the file holds `data-drawio` and two SVG pictures. |
| TheNamedPageIsDrawn | covered | Unit "TheNamedPageIsDrawn": `../diagrams/two.drawio`, page "2", is read as `diagrams/two.drawio` and only page 2 is handed to the painter. e2e: page "Context" by name and page "2" by number each show their own labels and not the other's. `ui/src/util/drawioPages.test.ts` covers names, numbers and unknown pages. |
| AFilledFrameIsLeftAlone | covered | e2e "AFilledFrameIsLeftAlone": a frame naming a diagram but holding a PNG keeps its `src` after 4 s, Save stays disabled, and no painter is mounted. |
| AMissingDiagramLeavesTheFrameEmpty | covered | Unit: a missing diagram answers `"../diagrams/missing.drawio" could not be read: not found`; a path climbing above the root is clamped for the server to confine. e2e "AMissingDiagramLeavesTheFrameEmpty": missing and broken frames show the placeholder, the status names both with their reasons and says one was drawn, a root-relative `/diagrams/…` frame is drawn, and after saving the failed frames have no `src` in the file. |
| ADiagramSurvivesTheExport | covered | e2e, in the first test: the Word export's `word/media/poster.png` is decoded in the browser; the frame's area holds more than 500 dark pixels and a blank area below none. |
| TheSkillNamesDiagramFrames | covered | `posters/test/guide.test.ts`: the skill holds the frame with `data-drawio`/`data-drawio-page`, says the editor draws it on open, and says never to copy a diagram's SVG into the markup. |

Also: `posters/test/diagrams.test.ts` (base64 round trip with accents, size from width/height or viewBox, refusals over 2 MB or without size).

Running app: `web` rebuilt and the server started on a scratch project. A monkey pass checked several cases, all ending right with no page errors:
- leaving the poster while its diagrams draw, then closing the file during a draw, leaves no painter behind;
- a frame naming page B shows page B;
- the Insert/diagram list opened five times quickly, then Escape, closes it;
- a double click on a diagram places it once, and undo removes it;
- a diagram rewritten on disk before it is chosen is drawn as it is now.

The pass found two defects, both fixed: the Insert menu opened under a diagram list still showing, and Escape did nothing while the list was loading.

Agent behaviour: the skill change could not be exercised with a live model in this container, which has no provider credentials. It is covered by the skill test only.

Not this change's: in this container, `e2e/openwebui-posters.spec.ts` "TheDefaultSandboxStillShowsThePoster" fails while loading `light-my-request` (`fastify.inject`), before any editor code; it passed in CI on `main`.
