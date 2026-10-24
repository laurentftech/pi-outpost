# Proposal

## Why

A teacher already gets good posters, worksheets and slides from Claude, written as HTML with pictograms, but cannot touch them up herself: correcting one word means asking the model again, and the result is not a Word or PowerPoint file she can print or show. `claude-office-editing` answered this with ONLYOFFICE, a hosted service and three adapters; a probe on `probe/poster-editor` showed a far smaller answer works in Claude Desktop today — an editor in the conversation over the HTML the model already writes, and a picture-perfect export to Word and PowerPoint.

## What Changes

- A **poster** is one printable page, `<title>.poster.html`: markup and stylesheet the model writes, in a fixed paper format (A4 or A3, portrait or landscape) or a 16:9 slide. No script, nothing fetched.
- An **editor** shows a poster where the person works and lets her correct a text in place (it rewraps), move an element, change a colour, font or size, undo, zoom and fit the page, and save. It follows the host's light or dark theme; the poster keeps its own colours.
- **Export to Word** (an A4 or A3 page with Word's narrow margins, the poster centred) **and PowerPoint** (one standard 16:9 slide, the poster centred). The poster travels as a picture drawn by the browser at about 300 dpi; texts are corrected in the editor, not in Office.
- One shared package, `@pi-outpost/posters`, holds the format, the guide the model reads, the editor, the picture and the Office packaging, so every host behaves alike. Three hosts use it:
  - **Claude Desktop**: a separate MCP extension, "Posters (pi-outpost)", keeping posters in a folder the person picks with every revision, as the probe does.
  - **pi-outpost**: a poster is an ordinary project file the agent writes with its file tools; the file viewer opens it in the editor and saves back to the file.
  - **Open WebUI**: poster tools on the tool server and an embed carrying the editor and the exports. **Limitation**: touch-ups made there stay in the browser — the user's browser has no route to the tool server, so the model's next change starts from its own version. A browser-reachable route with short-lived signed tickets is deferred until a deployment needs it.
- **Removed**: the `claude-office-editing` change, superseded. Nothing of it was implemented.

## Capabilities

### New Capabilities
- `poster-documents`: what a poster is — the page format, its paper formats, its limits, the guide the model follows — and its export to Word and PowerPoint.
- `poster-editor`: retouching a poster in a host — editing in place, moving, styling, undo, zoom and fit, saving against the revision it opened, theme, and the isolation the editor runs in.
- `mcp-poster-app`: the Claude Desktop extension — its folder and history, its tools, the view, and what reaches the model.
- `poster-files`: posters in pi-outpost — the agent writing them, the file viewer opening them in the editor and saving to the file.
- `openwebui-posters`: posters on the Open WebUI tool server — its tools, the embed, and the touch-up limitation.

### Modified Capabilities
None. The plannings extension, the draw.io viewer and the Open WebUI planning and office tools keep their contracts; posters are added beside them.

## Impact

- **New package** `posters/` (`@pi-outpost/posters`): format and guide (isomorphic), editor, page picture and Office packaging (browser). Dependencies: `grapesjs` and `grapesjs-parser-postcss` (BSD-3-Clause), as probed.
- **`mcp/`**: the probe's `src/posters/`, `viewer/poster.*`, `manifest-posters.json` and `scripts/pack-posters.mjs` move onto the shared package; Office packaging leaves the server for the browser; the probe's diagnostic log is dropped or kept behind a setting.
- **pi-outpost**: `ui/src/components/FileViewer.tsx` routes `.poster.html` to the editor; a bundled skill teaches the agent the format; the editor needs a frame isolated from the application (see design — the open risk).
- **`openwebui/`**: poster routes, OpenAPI and descriptions, the embed page and viewer, and the per-user poster store.
- **Docs**: `docs/claude-desktop.md`, the Open WebUI guide, README; credits for GrapesJS.
- **Release**: a second `.mcpb` (`pi-outpost-posters.mcpb`) beside the plannings one.
