# Tasks

## 1. Risks first

- [x] 1.1 Probe the pi-outpost isolation (design decision 4) in `scripts/probes/`: GrapesJS in a frame page under the planned CSP, fed a poster carrying `onerror`/`onclick` attributes, a `javascript:` link and an SVG `<script>`. Verify in the running bench that none runs and that the frame cannot read the app's token. On failure, record the second-origin fallback in design.md before group 4.
- [x] 1.2 Probe the local Open WebUI 0.12.3 (`:3000`): embed a 1.4 MB self-contained page with GrapesJS, once with the same-origin frame setting off and once on. Record whether the editor runs, and that the read-only fallback draws in the default setting, in design.md.
- [x] 1.3 Check the page picture in WebKit (Playwright `webkit`) on both real posters from the probe: compare the PNG with Chromium's by eye and record the result in design.md.

## 2. The shared package

- [x] 2.1 Create `posters/` (`@pi-outpost/posters`, workspace, MIT) with `format.ts`: formats and page sizes, limits, `pageOf`/`readPage` with the meta/style/wrapper markers, script and size refusals. Unit tests in `posters/test/format.test.ts` cover every `poster-documents` format, refusal and round-trip scenario.
- [x] 2.2 Move the guide into `guide.ts` as the one source. Test that the MCP and Open WebUI descriptions and the pi-outpost skill embed it verbatim (`EveryHostGivesTheSameGuide`).
- [x] 2.3 Export the default theme's parts from `office/src/defaultTemplate.ts` as pure strings (zip writing left to callers), keeping `defaultTemplateBytes` byte-identical. Verify with the existing office tests.
- [x] 2.4 Write `office.ts` over `Uint8Array` with a stored-entry zip and CRC-32: Word (narrow margins, inline centred, A4/A3/landscape/16:9 on A4 landscape) and PowerPoint (16:9 slide, centred). Tests parse the packages and assert page size, margins, slide size and picture extents for every format; then open the probe's two posters in Quick Look and, through the user, in desktop Word and PowerPoint.
- [x] 2.5 Move `pagePicture` into `picture.ts` and the editor into `editor.ts`/`editor.css` with the host adapter (save, deliver, theme, display mode). Keep the probe's fixes: postcss parser, `widthMedia: ""`, wrapper sizing, fixed inline height, full-screen bottom clearance, infinite canvas with fit and zoom, style panel closed inline, theme tokens. Add the sanitiser (event attributes, `javascript:` URLs, `iframe`/`object`/`embed`/`base`/`meta`/`link`) with unit tests.
- [x] 2.6 Add GrapesJS and the postcss parser to `docs/` credits and the settings Credits list. Verify with the Credits test.

## 3. Claude Desktop extension on the package

- [x] 3.1 Rebuild `mcp/src/posters/` and `mcp/viewer/poster.*` on the package. Replace the server-side export with the app-only `save_export` (bytes from the view, never-overwrite naming). Put the debug log behind `POSTERS_DEBUG`. Tests in `mcp/test/posters.test.ts` drive every `mcp-poster-app` tool scenario over the SDK client, including the refusal of a stale update and the shared folder with plannings.
- [x] 3.2 Turn `scripts/probes/poster-editor.mts` into `e2e/mcp-poster-app.spec.ts` on the e2e host harness (`sandbox` option). It covers editing in place, rewrapping, dragging, one-element styling, undo, the stale save, style panel and theme switching, inline height and download naming. Add the monkey pass: double clicks on Save, exporting mid-edit, switching theme and full screen during a save.
- [x] 3.3 Pack `pi-outpost-posters.mcpb` in the release scripts beside the plannings bundle, and write the Claude Desktop guide section in `docs/claude-desktop.md`. Install it in Claude Desktop and check a poster is shown, edited, saved and exported, through the user.

## 4. pi-outpost

- [x] 4.1 Serve the editor frame page with its CSP from the server (or the second origin, if 1.1 chose it). Route `*.poster.html` in `FileViewer.tsx` to it, with the source mode and the unreadable-file message. Component tests cover routing and the broken-file case.
- [x] 4.2 Wire save via `postMessage` (source checked) to the file API with the content hash at open; refuse outside the write zone and on a changed file. Wire exports to blob downloads in the parent. Server tests cover the write-zone refusal and the changed-file refusal.
- [x] 4.3 Write the bundled `posters` skill with the shared guide and one complete example poster. Verify with a live agent run that a `.poster.html` is written and opens in the viewer (one short run). *Done 2026-10-24 with mistral/devstral-medium-latest in the live bench: asked in French for an A4 class-rules poster for CE2, it loaded the posters skill itself, wrote `regles-classe-ce2.poster.html` (readPage: A4-portrait, emoji pictograms), and linked it in the reply; the link opened the editor.*
- [x] 4.4 Rebuild `web`, `@pi-outpost/embed` and `build:e2e-host`, then drive the bench (`npm run bench`, `127.0.0.1:4321`). Open, edit, save, reopen to see the change, export both formats. Then break it: switch project during a save, delete the file under the open editor, double-click Save, toggle source mode mid-edit. Record what broke and fix it. *Done 2026-10-24: edit, save to disk, Word and PowerPoint downloads under the poster's name, live theme switch. Broken and fixed: unsaved touch-ups dropped without a question on "source" and close (now reported to the viewer's touch-up guard); the frame's minimum height pushed the status line under the composer; the viewer's text-to-Word button shown for a poster; the style panel open in the viewer; the theme posted before the frame was listening. Held: a save over a file the agent rewrote, or deleted, is refused and nothing is written; switching file mid-save writes only the poster.*
- [x] 4.5 Document posters in the README and the user docs, and add an `e2e/poster-files.spec.ts` for the viewer scenarios on the running app.

## 5. Open WebUI

- [x] 5.1 Add the per-user poster store and the routes (list/create/get/update/show) with OpenAPI entries and descriptions carrying the guide. Tests in `openwebui/test/` cover per-user separation and the stale-update refusal.
- [x] 5.2 Build the embed page (gzip + base64, no `&`) carrying the editor: no save, a visible note that touch-ups stay in the browser, browser-side exports, and the read-only fallback without the same origin. Unit tests check the page holds no `&` and makes no request.
- [x] 5.3 Drive it on the local Open WebUI 0.12.3 with Playwright: show a poster, edit, export both formats, and check the note. Repeat with the same-origin setting off for the fallback. Update the Open WebUI guide with the limitation and the embed size. *Progress 2026-10-24: live run on Open WebUI 0.12.3 with codestral-2508 — create_poster then show_poster, embed drawn, read-only fallback with the setting off, ↓ word gave a real .docx. Fixed from it: 💾 shown in read-only (hidden lost to the icon's display), fallback message now names "iframe Sandbox Allow Same Origin". Guide written, image builds and serves posters (test/image.sh). Left: the same run with the setting on.*

## 6. Closing

- [x] 6.1 Remove `openspec/changes/claude-office-editing/`, superseded. Verify `openspec list` no longer shows it.
- [x] 6.2 Write `scenario-coverage.md` mapping every `#### Scenario:` (`rg '^#### Scenario:' openspec/changes/poster-editor`) to its test, read the assertions, and run `npm run check:scenarios` and `openspec validate poster-editor --strict`.
- [x] 6.3 Run lint and the full suites (`npm test`, the mcp and openwebui packages, e2e). Reread new tests for Windows paths and line endings, and regenerate `package-lock.json` with `npx -y npm@11 install --package-lock-only`.

## Workflow follow-up

- Archive the change from `main` after merge (`/opsx:archive`), never from the feature branch.
