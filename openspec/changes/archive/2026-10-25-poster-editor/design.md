# Design

## Context

The probe on `probe/poster-editor` (uncommitted when this was written) runs in Claude Desktop: an MCP extension (`mcp/src/posters/`, `mcp/viewer/poster.*`, `mcp/manifest-posters.json`), GrapesJS 0.23.8 in the view, and Word/PowerPoint export drawn in the view and wrapped on the server (`mcp/src/posters/office.ts`). It was checked in a test host (`scripts/probes/poster-editor.mts`), in Claude Desktop by hand, and its exports in desktop Word and PowerPoint. What it found shapes most decisions below:

- GrapesJS draws the page in a frame of its own. Under `sandbox="allow-scripts"` alone that nested frame is unreachable (`scripts/probes/nested-frame-sandbox.mjs`), so GrapesJS needs `allow-same-origin`. The MCP Apps specification requires that, on an origin apart from the host's. Claude grants it.
- GrapesJS's default CSS parser goes through the browser and drops every declaration using `var()`; `grapesjs-parser-postcss` keeps the stylesheet as written. A device with a width files component styles under a media query unless `widthMedia: ""`. The page is GrapesJS's wrapper `div`, not `body`.
- Claude sizes the frame from the page's own height. A page sized `100vh` stayed at zero and was never seen. Full screen draws Claude's reply bar over the bottom of the window, with no inset given.
- A download's file name is taken from the resource URI as written: an encoded space stays `%20`.

pi-outpost draws `.drawio` files in an `allow-scripts`-only frame with its own CSP (`ui/src/util/drawioPage.ts`), because the viewer must reach neither the application nor, in a widget, the host page. Open WebUI embeds a tool's page in a frame the user's browser loads from Open WebUI's stored copy. The tool server is never reachable from it, and the page carries everything (`openwebui/src/embed.ts`). OpenLore was unavailable while this was written (native binding missing), so this was found by direct inspection.

## Goals / Non-Goals

**Goals:**
- One implementation of the format, the guide, the editor, the page picture and the Office packaging, used unchanged by the three hosts.
- Exports built entirely in the browser, so no host needs a server round trip or Node to make a `.docx` or `.pptx`.

**Non-Goals:**
- Editable Word or PowerPoint content: the poster goes into Office as a picture.
- Sending Open WebUI touch-ups back to the server (proposal: the limitation; a browser-reachable route is a later change).
- A model-facing tool for targeted edits, such as replacing one block's text. `update_poster` replaces the markup and stylesheet whole, as probed; targeted operations are a later optimisation for token cost.

## Decisions

### 1. A shared package, `posters/` (`@pi-outpost/posters`)

```
posters/src/format.ts    formats, page sizes, limits, pageOf / readPage, refusals   (isomorphic)
posters/src/guide.ts     the guide text, one source for every host's descriptions    (isomorphic)
posters/src/office.ts    posterDocx / posterPptx over Uint8Array                       (isomorphic)
posters/src/picture.ts   the page as a PNG: SVG foreignObject → canvas               (browser)
posters/src/editor.ts    GrapesJS set-up, the bar, zoom/fit, style panel, theme      (browser)
posters/src/editor.css
```

The editor takes a small host adapter: `save?(html, css, base) → saved | refused`, `deliver(file)` (download or save), `theme`, `displayMode`, `requestFullscreen?`. Each host builds its own page from it: the MCP view, the pi-outpost frame page, the Open WebUI embed. This follows `apps-core` for the plannings, which is shared by source and not by a published module.

*Alternative*: keeping the code in `mcp/` and copying it per host. Rejected: three editors drift, and the probe's fixes (parser, wrapper sizing, heights) would each be found three times.

### 2. The file is the poster

A poster file is a complete page: `<meta name="poster-format" content="A4-portrait">`, the stylesheet in `<style data-poster>`, the markup inside `<div class="poster-page">`. `readPage` reads it back, and refuses a file with no format marker or with a script. In pi-outpost the file is the only copy, and git is its history. In Claude and Open WebUI the store keeps revisions beside it, as probed, and writes the file from the latest revision.

*Alternative*: a JSON document (markup, stylesheet, format). Rejected: it no longer opens and prints in a browser, which is what the person does with it outside the hosts.

### 3. Office packaging in the browser, uncompressed

`office.ts` writes the zip with stored entries (no deflate) and its own CRC-32. The PNG is already compressed and the XML parts are a few kilobytes, so the file is barely larger, and no `zlib` is needed. The deck keeps reusing pi-outpost's built-in Office theme (`office/src/defaultTemplate.ts`); its parts are produced by pure string functions, which the package uses without the Node zip writer. Word places the picture inline and centred (an anchored picture moved in Quick Look; one behind the text came out washed out); the page keeps Word's narrow margins, and the picture is fitted 2 mm short of the text area so it never spills onto a second page. PowerPoint always uses the 16:9 slide.

*Alternative*: keeping packaging on the server (the probe). Rejected: the Open WebUI embed cannot reach its server, and in Claude it sent the picture up and the file back down.

### 4. Isolating the editor in pi-outpost: one origin, a strict policy, a cleaned poster

GrapesJS cannot run in an `allow-scripts`-only frame (Context), so the draw.io isolation cannot be reused as it is. The editor runs in a frame page served by pi-outpost, under a Content-Security-Policy: no inline scripts, no `eval`, scripts from that page's own bundle only, `connect-src 'none'`, and no objects, forms or base URI. GrapesJS's canvas frame is `about:blank` and inherits the policy, so a poster's event handler, `javascript:` link or inline SVG script cannot run. The poster is also cleaned before loading: event attributes, `javascript:` URLs, `iframe`, `object`, `embed`, `base`, `meta` and `link` elements are removed, as a second layer. The frame holds no token. Saving and downloading go to the parent by `postMessage`, which checks the source and writes through the existing file API with the content hash the file was opened at.

**Probed (task 1.1, `scripts/probes/poster-isolation.mts`).** A real HTTP server served an "application" page holding a token and the editor frame under the policy, on one origin. The frame was fed a poster carrying `onerror`/`onclick`/`onmouseover`, a `javascript:` link, an SVG `<script>` and `onload`, an `iframe srcdoc` script, an inline `<script>`, an `object`, a form, remote images, a CSS `@import` and a background URL, then clicked and double-clicked through. With the policy, nothing ran, no request left, and a text was still edited in place. Without it (`NOCSP=1`), no script ran either, because GrapesJS drops scripts and event attributes when it parses. But four requests left: an image, two CSS backgrounds and the object. So the policy is what closes the network, and the parser is a first layer under it. The probe also found GrapesJS posting **telemetry to `app.grapesjs.com`** and loading **Font Awesome from a CDN** unless configured with `telemetry: false` and `cssIcons: ""`, which every host's editor must set (the policy blocked both). The trusted editor frame can reach its parent: it is same-origin by design, so the guard is that only the editor's own bundle runs in it.

*Alternative*: a second origin for the editor, as the MCP Apps specification arranges, either a second port or another host name. Kept as the fallback if the policy cannot be made to hold. It means a second listener, its configuration in every deployment (WSL, Tailscale names, the embed bench's fixed ports), and a widget's host page in the picture.

### 5. pi-outpost: a skill and the file viewer, no tool

The agent writes posters with its file tools, guided by a bundled `posters` skill carrying the shared guide and one complete example (weak models skip a skill's references). This follows the `drawio` skill. `FileViewer` routes `*.poster.html` to the editor, with the source mode beside it. Saving goes through the file API's write path, refused outside the write zone or when the file changed since it was opened. Exports download through a blob link in the parent.

### 6. Open WebUI: an embed with the editor, no save

Poster routes mirror the plannings', with a per-user store. `show_poster` returns the self-contained page: the editor bundle, the poster and the bootstrap, gzipped and base64-encoded as the plannings embed is, so the page holds no `&`. The embed saves nothing to the server and says so (spec: `TouchUpsStayInTheBrowser`). If Open WebUI's frames are not allowed the same origin, GrapesJS cannot run: the embed then shows the poster read-only, drawn in place, with the exports, and says editing needs that setting.

**Checked (task 1.2).** This was read from Open WebUI 0.12.3's own source, taken from the running container's source maps, and not driven through a chat, which would need a model run; task 5.3 does that. A tool embed is a `srcdoc` frame (`ToolCallDisplay` → `FullHeightIframe`) sandboxed `allow-scripts allow-popups allow-downloads`. `allow-same-origin` is added only when the user turned on "iframe sandbox allow same origin", off by default, and `allow-forms` only by its own setting. `scripts/probes/poster-owui-sandbox.mts` reproduces both frames with a 2.6 MB page carrying GrapesJS:
- *Default sandbox:* GrapesJS cannot reach its canvas and fails. A check made before loading (create a frame, read its document) answers `false`, so the embed knows to fall back.
- *With the setting on:* the editor loads and a text is edited.

`allow-downloads` is in both, so the exports work either way. **Security consequence:** with the setting on, a `srcdoc` frame takes Open WebUI's own origin, so it could read Open WebUI's session. The embed page therefore carries its own policy in a `<meta http-equiv="Content-Security-Policy">`, the editor policy of decision 4. Admins may also set `ui.iframe_csp`, which Open WebUI injects; ours applies on top of it. GrapesJS's parser drops scripts and event attributes as a first layer (task 1.1).

### 7. Claude: the probe, moved onto the package

The probe's server keeps its store and tools. Export becomes an app-only tool that saves the bytes the view made (`save_export`), and the view offers them through `ui/download-file`. The diagnostic log (`.posters/debug.log`) stays, off unless `POSTERS_DEBUG` is set; it was what found the earlier invisible view.

## Risks / Trade-offs

- [The pi-outpost policy does not hold, or GrapesJS needs something it forbids] → The first task is a probe in the running app: a poster carrying handlers, `javascript:` links and SVG scripts, and a check that none runs and that the frame reads no token. On failure, the second origin (Decision 4) replaces it before the viewer is built.
- [Open WebUI's default sandbox refuses the same origin] → The read-only fallback (Decision 6); checked on the local Open WebUI 0.12.3 before the embed is finished.
- [`infiniteCanvas` is marked experimental in GrapesJS] → It is pinned at 0.23.8; zoom buttons and fit work without it, so the fallback is to drop scrolling and keep zoom and fit.
- [The page picture depends on the browser drawing an SVG `foreignObject`: Chromium does, and Claude Desktop and pi-outpost's users run Chromium or WebKit] → Checked in WebKit (task 1.3, `scripts/probes/poster-picture-webkit.mts`, Playwright WebKit 27.2) on both real posters. It **found a bug**: WebKit draws a `foreignObject` at its own size whatever the SVG's `viewBox`, so the page came out at 1:1 in a corner of the 2481 × 3509 canvas. The page is now scaled by a CSS `transform` inside a `foreignObject` the picture's size. After the fix, Chromium and WebKit agree at full resolution: text, emoji, dashed SVG arrows, borders and rounded corners. A browser that refuses gets a message, not an empty file.
- [The editor bundle is 1.4 MB, close to three times the plannings view] → It rendered in Claude Desktop; an Open WebUI embed of that size is stored in every chat that shows a poster, which is noted in the Open WebUI guide.
- [Posters are pictures inside Office] → Said in the guide and in the editor's button titles; texts are corrected in the editor.

## Migration Plan

Nothing deployed depends on the probe. `claude-office-editing` is removed in this change, superseded and never implemented. The probe's branch is the starting point; its `.mcpb` was installed only by the developer and is replaced by the released one.

## Open Questions

- Whether the posters extension should later share one `.mcpb` with the plannings: kept separate here, as probed, so each can be installed alone.
