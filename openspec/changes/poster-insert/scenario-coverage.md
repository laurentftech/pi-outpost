# Scenario coverage — poster-insert

Every `#### Scenario:` of the change's five delta specs (`rg '^#### Scenario:' openspec/changes/poster-insert`, 43 in all), the test that would fail if its contract broke, and what that test asserts. Browser tests run on Chromium. The editor tests run in the MCP host frame Claude Desktop uses (`e2e/mcp-poster-host.ts`, `allow-scripts allow-same-origin`). The same editor is also driven in pi-outpost's file viewer (`e2e/poster-files.spec.ts`) and in the Open WebUI embed (`e2e/openwebui-posters.spec.ts`).

## poster-documents

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AScriptIsRefused | covered | Unchanged by this change. `posters/test/format.test.ts` — "AScriptIsRefused": a `<script>` in the markup, an upper-case one inside SVG, a `src` script, and one inserted into a written page are each refused; `mcp/test/posters.test.ts` and `openwebui/test/posters.test.ts` ("PosterTools refuse what the format refuses") check the tools write nothing. |
| ARemoteImageIsNotFetched | covered | Unchanged by this change. `e2e/poster-files.spec.ts` — "APosterCannotReachTheApplication…": a remote image is refused by the frame's policy and no outside response arrives. `e2e/openwebui-posters.spec.ts`: no request while showing and exporting. `e2e/mcp-poster-elements.spec.ts` — "AnEmptySlotIsShown" records every request while an empty frame is drawn: none leaves for a picture. |
| AnOversizedPosterIsRefused | covered | `posters/test/format.test.ts` — "AnOversizedPosterIsRefused": at `MAX_POSTER_BYTES` the refusal reads "too large: 8.0 MB, above the 8.0 MB … Shrink or remove pictures or drawings"; counted in bytes; one byte under passes. `openwebui/test/posters.test.ts` — "PosterTools refuse…": `MAX_POSTER_BYTES + 1` is a 413 and nothing is listed. `server/test/fileBrowser.test.ts` — "refuses a poster above its ceiling…": the file viewer refuses to open or save it, saying to shrink or remove pictures. |
| APosterWithSeveralPicturesFits | covered | `posters/test/format.test.ts` — "APosterWithSeveralPicturesFits": six 250 kB pictures as base64 pass `checkPoster` unchanged. `openwebui/test/posters.test.ts` — "a poster near the 8 MB ceiling is saved through the embed's capability": revision 3, status 200. `server/test/fileBrowser.test.ts` — "opens and saves a poster holding pictures beyond the 1 MB preview limit": a 6 MB poster opens and saves, the same file named `.html` is refused. |
| EveryHostGivesTheSameGuide | covered | `posters/test/guide.test.ts` — "EveryHostGivesTheSameGuide (pi-outpost)": the skill holds `POSTER_GUIDE` and the example verbatim. `mcp/test/posters.test.ts` and `openwebui/test/posters.test.ts`: the tool descriptions embed `POSTER_GUIDE`. |
| TheGuideTeachesSlotsAndDrawings | covered | `posters/test/guide.test.ts` — "TheGuideTeachesSlotsAndDrawings": the guide shows `<img data-poster-picture="bread" alt="bread">`, says the editor removes the empty look once filled, asks for `<div class="drawing">` holding one `<svg>` with a viewBox and no text, tells to keep markers exactly, and no longer says "No picture embedded as data" or "small inline SVG shapes". The example holds a drawing in its holder and a dashed empty frame. |

## mcp-poster-app

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ThePosterFileFollowsItsNewTitle | covered | `mcp/test/posters.test.ts` — "ThePosterFileFollowsItsNewTitle": after `update_poster` with title "Menu du jour", the folder holds only "Menu du jour.poster.html", whose page title is the new one; `get_poster` by the same id reads revision 2 under the new title and revision 1 still reads; the same title again renames nothing. |
| ARenameNeverOverwrites | covered | `mcp/test/posters.test.ts` — "ARenameNeverOverwrites": a second poster retitled "Menu du jour" gets "Menu du jour (2).poster.html", the first file's bytes are unchanged, and the old "Draft.poster.html" is gone. |

## openwebui-posters

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheNewTitleIsListed | covered | `openwebui/test/posters.test.ts` — "TheNewTitleIsListed": the update answers the new title, `get_poster` and `list_posters` give "Menu du jour", and a blank title is refused with 422. |

## poster-editor

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AFittedPageCannotBeScrolledAway | covered | `e2e/mcp-poster-elements.spec.ts` — "AFittedPageCannotBeScrolledAway…": after scrolling 3000 px in each of the four directions, every edge of the fitted page is still inside the visible area (≥ −1 px). Probe `scripts/probes/poster-pan-limit.mts`. |
| AZoomedPageKeepsTheViewFilled | covered | Same test: zoomed in four steps (the page taller than the view), after scrolling far each way no edge on an axis where the page is larger comes more than 17 px inside, and on an axis where it is still smaller it stays inside. |

## poster-elements

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AnEmptySlotIsShown | covered | `e2e/mcp-poster-elements.spec.ts` — "AnEmptySlotIsShown": the empty frame is drawn dashed at 260 px, no request is made, and after a save its saved `<img>` holds no `src` (GrapesJS's placeholder is not written). |
| ThePersonFillsASlot | covered | `e2e/mcp-poster-elements.spec.ts` — "ThePersonFillsASlot…": a double-click opens the file chooser, the frame then holds `data:image/png`, and its box is identical before and after. Also in `e2e/poster-files.spec.ts` ("Pictures and shapes in the file viewer": the saved file holds the picture as data) and `e2e/openwebui-posters.spec.ts` ("Open WebUI embed: a frame filled…"). |
| TheDashedFrameGoes | covered | `e2e/mcp-poster-elements.spec.ts` — "…TheDashedFrameGoes…": the filled frame's computed border is `none` and its background transparent; the other frame stays dashed with its tint. `e2e/mcp-poster-elements.spec.ts` — "Monkey": undo after a fill brings the dashes back. |
| TheMenuListsWhatCanBeInserted | covered | `e2e/mcp-poster-elements.spec.ts` — "TheMenuListsWhatCanBeInserted": the menu's items are exactly Picture…, Text and the eight shapes in order; it closes on a choice, on Escape, and on a press in the page. |
| AReadOnlyPosterOffersNoInsert | covered | `e2e/mcp-poster-elements.spec.ts` — "AReadOnlyPosterOffersNoInsert": under a sandbox without same-origin the Insert control is hidden. `e2e/openwebui-posters.spec.ts` — "TheDefaultSandboxStillShowsThePoster": hidden in Open WebUI's default sandbox. |
| APictureIsInsertedOnThePage | covered | `e2e/mcp-poster-elements.spec.ts` — "APictureIsInsertedOnThePage…": with nothing selected the picture is a third of the page wide, centred on (397, 561.5) within 5 px, selected, and every card and the title keep their boxes. |
| InsertPictureFillsTheSelectedSlot | covered | Same test: with the soup frame selected, Insert → Picture puts `data:image/png` into that frame. |
| ATextBoxIsAdded | covered | `e2e/mcp-poster-elements.spec.ts` — "ATextBoxIsAdded…": typing right after Insert → Text replaces the placeholder; the box is centred, 32 px, in the poster's Verdana; `get_poster` after a save holds the text. |
| ATextBoxIsMovedAndResized | covered | Same test: a drag moves it by the screen distance over the zoom; pulling its right handle 80 px left narrows it by more than 60 page px and its height grows (the text rewraps). |
| AShapeIsAdded | covered | `e2e/mcp-poster-elements.spec.ts` — "AShapeIsAdded…": the ellipse is centred, selected and shows its side handle; a second shape steps aside. Also `e2e/poster-files.spec.ts`: a speech bubble is saved into the file with the shape rules in its stylesheet. |
| AShapeIsStretched | covered | Same test: pulling the rectangle's right handle 60 px widens it by 60 over the zoom while its height is unchanged, and its SVG stretches to the new width. |
| AShapeIsRecoloured | covered | `e2e/mcp-poster-elements.spec.ts` — "AShapeIsRecoloured…": Fill set to #2e7d32 in Format repaints the selected rectangle only (the other stays rgb(79, 195, 247)); with the title selected the Fill field is hidden. Probe `scripts/probes/poster-shape-colours.mts` recorded the same at 1.2. |
| AShapeKeepsItsColoursInTheExport | covered | Same test: the Word export's page picture, decoded, has rgb(46, 125, 50) at the green rectangle's place. |
| TextIsTypedInAShape | covered | `e2e/mcp-poster-elements.spec.ts` — "TextIsTypedInAShape…": typing after a double-click on a rectangle puts "Entrée" in its text element, centred on the shape within 2 px; `get_poster` after a save holds `<div class="poster-shape-text">Entrée</div>`. |
| TheTextFollowsItsShape | covered | Same test: a click still selects the shape, not its text; a drag of the shape leaves the text's offset from the shape's centre unchanged; Format's colour on the shape makes the text rgb(211, 47, 47). |
| TheTailPointsElsewhere | covered | `e2e/mcp-poster-elements.spec.ts` — "TheTailPointsElsewhere…": the handle sits at the default tip (18 %, 140 %); dragged above and right, `data-tail` becomes about (80, negative), the path's tail leaves the top side (`M 12 0 L … 0 L x y L … 0 L 88 0`), and the handle stands where it was released; moving the bubble carries the handle. |
| TheTailIsKept | covered | Same test: saved and reopened in a new page, the bubble's `data-tail` is unchanged and the handle shows when it is selected. |
| APictureIsDroppedOnACard | covered | `e2e/mcp-poster-elements.spec.ts` — "APictureIsDroppedOnACard…": a PNG dropped on the dessert card is centred on the card within 5 px; a text file dropped is ignored; a file dropped beside the page is default-prevented and the editor says where to drop. |
| APictureIsDroppedOnASlot | covered | Same test: a JPEG dropped on the bread frame fills it. |
| ALargePictureIsScaledDown | covered | `e2e/mcp-poster-elements.spec.ts` — "…ALargePictureIsScaledDown": a 2400 × 1800 PNG becomes 1200 × 900 natural pixels in the frame. "Monkey": a 3000 × 2000 picture chosen before a 300 × 200 one leaves the frame at 300 (the last choice wins). |
| ATransparentPictureStaysTransparent | covered | `e2e/mcp-poster-elements.spec.ts` — "ATransparentPictureStaysTransparent…": the embedded PNG's corner pixel has alpha 0 and its middle 255; an SVG file, which the bitmap decoder refuses, is still placed as a PNG. |
| AFileThatIsNotAPictureIsRefused | covered | Same test: a "broken.png" that is not a picture leaves the status "This file could not be read as a picture." and every picture's source and border unchanged. |
| APictureInASlotIsMoved | covered | `e2e/mcp-poster-elements.spec.ts` — "APictureInASlotIsMoved…": a `mousedown` on the picture is default-prevented (no native drag); a click leaves its box unchanged; a drag of (40, 30) moves it by that over the zoom, and it stays in its card. Checked in Claude Desktop by the user (the native drag that carried it off). |
| APictureIsResized | covered | Same test: pulling the bottom-right handle shrinks the width by more than 40 and keeps the ratio to one decimal. |
| APlacedPictureStillMovesAfterReopening | covered | `e2e/mcp-poster-elements.spec.ts` — "APlacedPictureStillMovesAfterReopening": a picture, a star and a text box placed, saved, then reopened in a new page each move by the dragged distance over the zoom, within 10 page px (snapping to guides). |
| AClickOnAShapeSelectsTheDrawing | covered | `e2e/mcp-poster-elements.spec.ts` — "AClickOnAShapeSelectsTheDrawing…": a click on the door's upper panel selects the `.drawing` holder, with a corner handle. |
| DraggingADrawingLeavesItsCard | covered | Same test: the drawing moves by 50 over the zoom while its card's box is unchanged; its corner resizes it with the ratio kept. |
| GetPosterReturnsMarkers | covered | `mcp/test/posters.test.ts` — "GetPosterReturnsMarkers": no `base64` in the answer, an inventory naming bread and class photo, both markers in place, the texts as saved; `show_poster`'s structured content carries no data and a count of 2; `poster_pictures` returns both in marker order. `openwebui/test/posters.test.ts` — "get_poster shows the user's picture as a marker…". `e2e/openwebui-posters.spec.ts` — the embed's saved picture reads as `poster-picture:1`. `posters/test/markers.test.ts` — "hidePictures…". |
| TheAgentReadsAPosterFileWithPictures | covered | `server/test/posterPictureHooks.test.mjs` — "TheAgentReadsAPosterFileWithPictures": through the real server and agent, `read` returns no `base64`, the inventory with sizes, both markers, the rest verbatim; offset and limit cut the marked file with the continuation notice. "A poster without pictures, and a file that is not a poster…" reads exactly. Live run (task 5.5): no tool result carried picture data. |
| TheModelRewritesAPosterAndKeepsItsPictures | covered | `mcp/test/posters.test.ts` — "TheModelRewritesAPosterAndKeepsItsPictures": the file after `update_poster` equals the saved poster with only the title changed. `openwebui/test/posters.test.ts` — "…update_poster puts it back": the shown embed holds the photo unchanged. `posters/test/markers.test.ts` — round trip and dropped-marker cases. |
| AnUnknownMarkerIsRefused | covered | `mcp/test/posters.test.ts` — "AnUnknownMarkerIsRefused": `poster-picture:5` is refused naming the range 1 to 2, the revision stays 2, and a new poster with a marker is refused ("it has none"). `openwebui/test/posters.test.ts`: 422, same message, revision unchanged. `server/test/posterPictureHooks.test.mjs`: the agent's `write` with `poster-picture:9` is blocked and the file is unchanged. `posters/test/markers.test.ts`. |
| TheAgentEditsAPosterFileWithPictures | covered | `server/test/posterPictureHooks.test.mjs` — "TheAgentEditsAPosterFileWithPictures": an `edit` whose `oldText` holds a marker and a whole `write` with markers leave the file equal to the original with only the edited texts changed, both pictures byte-identical. Live run (task 5.5): codestral's edits kept the filled picture byte-identical. |
