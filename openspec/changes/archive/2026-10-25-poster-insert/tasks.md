# Tasks

## 1. Risks first

- [x] 1.1 Probe pi's extension events on the pinned SDK in `scripts/probes/poster-agent-hooks.mts`:
  - a `tool_call` handler on `read` that points `event.input.path` at another file;
  - a `tool_result` handler that rewrites that path in the text;
  - a `tool_call` handler that mutates `content` of `write` and `old_string`/`new_string` of `edit`.

  Verify with an embedded session driven by a scripted fake provider that each mutation reaches the tool. If one does not, record the dedicated-tools fallback (design decision 6) in design.md before group 5.
- [x] 1.2 Probe GrapesJS 0.23.8's style manager with the custom properties `--shape-fill`, `--shape-line` and `--shape-line-width`, in a sector shown only for a `.poster-shape`. Verify in the MCP host frame that a colour picked there lands on that holder only and repaints its SVG. If not, record the fallback panel (design, Risks) in design.md before 2.6.

## 2. The shared package

- [x] 2.1 Raise `MAX_POSTER_BYTES` to 8 MB, and reword the refusal: give the size, and say to shrink or remove pictures or drawings. Verify with the `AnOversizedPosterIsRefused` and `APosterWithSeveralPicturesFits` tests in `posters/test/format.test.ts`.
- [x] 2.2 Add `hidePictures` and `restorePictures` (design decision 6) to the package, isomorphic. `data:image/…` URLs in `src` and in CSS `url()` become `poster-picture:N`, with a one-line inventory carrying slot names and sizes. Restoring refuses an unknown marker with its name, and drops pictures whose marker is gone. Verify with unit tests covering the round trip, an unknown marker, a removed picture, pictures in the stylesheet, and markup without pictures left byte-identical.
- [x] 2.3 Rewrite the guide:
  - picture slots (`<img data-poster-picture="name" alt="name">`, with the empty look only on `[data-poster-picture]:not([src])`);
  - SVG drawings, each in `<div class="drawing">` with a viewBox, no text, and about 50 kB at most;
  - emoji still allowed;
  - markers kept exactly as read;
  - no more "no picture embedded as data".

  Add a slot and a drawing to `POSTER_EXAMPLE`. Verify with `EveryHostGivesTheSameGuide` and a new `TheGuideTeachesSlotsAndDrawings` test.
- [x] 2.4 Finish pictures in `editor.ts` from the prototype:
  - the picker through `onActive`;
  - slots filled with their own border and background cleared;
  - scaling to 1200 px (PNG kept when it may be transparent);
  - dropping onto a slot or at the drop point;
  - `absolute` drag mode re-applied on open;
  - moves started after 4 px with native image drag prevented;
  - resize with the ratio kept;
  - an unreadable file refused with a status message.

  Verify with the e2e in 3.2, and with a unit test of `embeddablePicture` on a large PNG and a transparent PNG (jsdom canvas or the browser project).
- [x] 2.5 Add the Insert menu (design 3b) in place of the prototype's button: Picture…, Text, eight shapes. It closes on a choice, on Escape and on an outside click, and is hidden when read-only. Add text boxes (design 3c): centred, the placeholder selected for typing, width resizable. Verify with e2e scenarios `TheMenuListsWhatCanBeInserted`, `AReadOnlyPosterOffersNoInsert`, `ATextBoxIsAdded` and `ATextBoxIsMovedAndResized` in 3.2.
- [x] 2.6 Add the shapes (design 3d): eight path definitions drawn in the editor, the holder, the custom-property paint and non-scaling strokes, free resizing on eight handles. Exclude `.poster-shape` from the keep-the-ratio rule for SVG holders. Add the Format panel's Shape sector as 1.2 settled. Verify with e2e scenarios `AShapeIsAdded`, `AShapeIsStretched`, `AShapeIsRecoloured` and `AShapeKeepsItsColoursInTheExport` in 3.2, the last one reading the exported page picture.
- [x] 2.8 Text in shapes (design 3d): a double-click on a shape other than the line edits a centred text element inside it, inert to the mouse otherwise, styled through the holder. Verify with e2e scenarios `TextIsTypedInAShape` and `TheTextFollowsItsShape`.
- [x] 2.9 The speech bubble's tail (design 3d): the path is computed from `data-tail`, and a yellow handle at the tip is dragged to move it in any direction, committed on release. Verify with e2e scenarios `TheTailPointsElsewhere` and `TheTailIsKept`.
- [x] 2.10 Keep the page in view (poster-editor `ThePageStaysInView`): after every `canvas:coords` or `canvas:zoom`, pull the canvas back so a page smaller than the area stays inside it and a larger one uncovers at most 16 px. Probed in `scripts/probes/poster-pan-limit.mts`. Verify with e2e scenarios `AFittedPageCannotBeScrolledAway` and `AZoomedPageKeepsTheViewFilled`.
- [x] 2.7 Keep drawings whole (design decision 5): `svg, svg *` let the mouse through, `svg` and `svg-in` are inert, a single-SVG holder is resizable with its ratio kept. Verify with e2e scenarios `AClickOnAShapeSelectsTheDrawing` and `DraggingADrawingLeavesItsCard` in 3.2.

## 3. Claude Desktop extension

- [x] 3.1 `get_poster` returns the poster through `hidePictures`. `update_poster` runs `restorePictures` against `base_revision` before checking and writing, and returns the refusal for an unknown marker. `create_poster` refuses any marker. `show_poster`'s structured content carries markers and a picture count, and the view restores the pictures through the app-only `poster_pictures` (design decision 6). Update both descriptions: markers are pictures, keep them as they are. Verify with `mcp/test/posters.test.ts` scenarios `GetPosterReturnsMarkers`, `TheModelRewritesAPosterAndKeepsItsPictures` and `AnUnknownMarkerIsRefused`.
- [x] 3.2 Turn `scripts/probes/poster-pictures.mts` and `poster-slot-drag.mts` into `e2e/mcp-poster-app` tests, one per `poster-elements` editor scenario, with assertions on positions, sizes, borders and embedded data rather than screenshots. Assert that `mousedown` on a picture is default-prevented. Then a monkey pass:
  - double-click a slot while a picture is still being scaled;
  - drop two files at once;
  - insert while the Format panel is open;
  - drag a picture during a save;
  - undo right after a fill.

  Record what broke and fix it.
- [x] 3.3 Pack `pi-outpost-posters.mcpb` and check in Claude Desktop, through the user: fill a slot, insert a picture, a text box and a shape, recolour the shape, move and resize each, save, ask Claude to change a title, then check the pictures are still there and the Word export shows everything. Update `docs/claude-desktop.md`. *Done 2026-10-25 by the user in Claude Desktop with the packed extension: the file picker, Finder drop, moving a picture in its frame, the frame's dashes cleared on fill, then shapes and texts added; asked to retitle the poster "Menu du jour", Claude rewrote it from the markers and the picture, the shapes and the texts were all kept. Renaming the file is not offered by any poster tool (follow-up).*

- [x] 3.4 Rename a poster: `update_poster` takes an optional `title`; the store retitles the poster and renames its file after it, numbered rather than overwriting, keeping id, history and exports. Verify with `mcp/test/posters.test.ts` scenarios `ThePosterFileFollowsItsNewTitle` and `ARenameNeverOverwrites`.

- [x] 3.5 `get_poster` takes `see_pictures`: the pictures, up to eight, come back as image blocks after their markers. Verify with `mcp/test/posters.test.ts` scenarios `TheModelSeesWhatAFrameHolds` and `PicturesAreNotSentUnasked`.

## 4. Open WebUI

- [x] 4.3 `update_poster` takes an optional `title` that retitles the poster. Verify with `openwebui/test/posters.test.ts` scenario `TheNewTitleIsListed`.

- [x] 4.1 Apply `hidePictures` and `restorePictures` in the tool server's `get_poster` and `update_poster`, as in 3.1. Make the embed's save endpoint accept a poster at the 8 MB ceiling. Verify with `openwebui/test/posters.test.ts`: markers out, pictures restored, unknown marker refused, an 8 MB poster saved through the capability.
- [x] 4.2 Add to `e2e/openwebui-posters.spec.ts`, with the same-origin setting on: fill a slot, insert a shape, save, then `get_poster` returns markers. Without same-origin, no Insert control is offered. Update `docs/openwebui.md`.

- [ ] 4.4 `get_poster` takes `see_pictures`: the answer adds `pictures: [{ marker, image }]`, each image a whole base64 data URL that Open WebUI 0.12.3 hands the model as an image in native function calling. Verify with `openwebui/test/posters.test.ts` scenarios `TheModelSeesWhatAFrameHoldsInOpenWebUI` and `PicturesAreNotSentUnaskedInOpenWebUI`, and with one live check on the local Open WebUI with a model that takes images.

## 5. pi-outpost

- [x] 5.1 Let the file preview open `.poster.html` files up to the poster ceiling, and the editor's save through `write_file` carry them. Verify with server tests: a 6 MB poster opens and saves, a 9 MB one is refused with the poster wording.
- [x] 5.2 Add the hooks in `server/src/piOutpostTools.ts` (design decision 6, or the fallback 1.1 chose):
  - a `read` of a `*.poster.html` returns markers;
  - `write` and `edit` restore them from the file on disk;
  - an unknown marker blocks the call with its name.

  Verify with an embedded-session test driven by a fake provider for `TheAgentReadsAPosterFileWithPictures` and `TheAgentEditsAPosterFileWithPictures`, and with a test that a `.poster.html` without pictures reads unchanged.
- [x] 5.3 Update `skills/posters/SKILL.md`: slots, drawings, markers kept as read, `read` rather than `bash` for posters. Verify with the guide test from 2.3.
- [x] 5.4 Add to `e2e/poster-files.spec.ts`: fill a slot and insert a shape in the viewer's editor, save, check the file on disk holds the picture data and the shape. Rebuild `web`, `@pi-outpost/embed` and `build:e2e-host`, then drive the bench (`127.0.0.1:4321`) the same way. Break it: insert a picture then switch file before saving, delete the file under the editor after inserting, drop a picture on the source view. Record and fix what broke. *Done 2026-10-25 on the bench (server 4322):*
  - *Filled the class-photo frame, inserted a star and a text box, saved: the file on disk held the picture as data, the shape and the text.*
  - *File deleted under the editor after an insert: the save was refused with an explanation, and nothing was re-created.*
  - *Broken and fixed: a picture dropped beside the page, on the editor's own document, was not intercepted, so the browser would open the file in place of the editor. It is now refused, with where to drop (e2e).*
  - *Found, not fixed (predates this change, app-wide): switching to another file from the tree closes an editor holding unsaved changes without asking, poster or text editor alike.*
- [x] 5.5 One live agent run on the bench: ask the agent for a poster with picture frames and a drawing, fill a frame, save, then ask it to change the title. Read the transcript and the file: the agent read markers, and the file still holds the picture. Update the README posters section. *Done 2026-10-25 on a real server with mistral/codestral-latest:*
  - *First request (a menu poster with two frames and a drawn door): codestral did not load the posters skill and wrote a plain HTML page without the format meta. This is the known weak-model behaviour, which this change does not address.*
  - *Then the guide's example poster, its class-photo frame filled in the file viewer's editor and saved (49.5 kB), with the request to change the title. The agent read the poster with the inventory and `poster-picture:1`; no tool result the model received carried picture data. Its edits changed the `<h1>` and the `<title>`. The picture is byte-identical before and after, and no marker reached the file.*
  - *Codestral then repeated an identical no-op edit until stopped: a model loop, not the hooks, which pass edits through unchanged.*
  - *README posters section updated.*

- [x] 5.6 Add `poster_pictures` to pi-outpost's tools (embedded, sandboxed and RPC lists): the pictures of a `.poster.html` as images after their markers, up to eight or those named; a model without image input is told so; confined like `drawio_check`. Teach it in the posters skill. Verify with `server/test/posterPicturesTool.test.ts` scenarios `TheAgentSeesWhatAFrameHolds` and `AModelWithoutVisionIsToldSo`, the tool-list tests, and one live run with a vision model. *Done 2026-10-25 with google/gemini-2.5-flash on the user's renamed poster: asked what the "pain" frame shows, it called `poster_pictures` itself, received the 196 kB JPEG, and answered a family under an "AMOUR EN FAMILLE" banner, where Claude had said "your bread picture" from the frame's name.*

## 6. Integration

- [x] 6.1 Write `openspec/changes/poster-insert/scenario-coverage.md`, mapping every scenario (`rg '^#### Scenario:' openspec/changes/poster-insert`) to its test, reading the assertions. Verify with `node scripts/check-scenario-coverage.mjs --change poster-insert` and `openspec validate poster-insert --strict`.
- [x] 6.2 Run typecheck, lint, the posters, mcp, openwebui and ui suites, the server suite and e2e. Reread the new tests for Windows traps (`path.join` for expected paths, `/\r?\n/` splits). Verify that all are green.

## Workflow follow-up

- Archive the change from `main` after the PR merges, never from the feature branch.
- `poster-illustrator` (pictures generated through an image API) is the next change in this line.
- Switching files from the tree drops an editor's unsaved changes without asking (all editors), found on the bench.
