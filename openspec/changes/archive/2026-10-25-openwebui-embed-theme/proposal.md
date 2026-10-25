# Proposal

## Why

Open WebUI sends its embeds no theme — it hosts no MCP Apps, and passes nothing to a tool's frame — so the embeds pi-outpost's tool server returns (plannings, structures, documents, posters) follow the system's colour scheme. A user whose Open WebUI is dark on a light system, or the reverse, sees a light timeline or poster editor in a dark chat. With Open WebUI's "iframe Sandbox Allow Same Origin" setting on, the embed shares Open WebUI's origin and can read the theme Open WebUI puts on its own page.

## What Changes

- Every embed the tool server returns follows Open WebUI's own theme when it can read it — the `dark` class Open WebUI sets on its page's root element — including when the user switches theme while the embed is open.
- When it cannot (the setting off, the default: an opaque frame), it keeps following the system's colour scheme, as now, and now also follows a change of it while open.
- One shared piece of code decides the theme for all of them; the planning viewer (timelines, structures, download cards) and the poster editor use it.

## Capabilities

### New Capabilities
- `openwebui-embed-theme`: which light or dark theme the tool server's embeds draw in, and how they follow a change.

### Modified Capabilities
None. The planning, structure, document and poster contracts are unchanged; only the colours their embeds are drawn in follow a better source.

## Impact

- `openwebui/viewer/` (the planning viewer's `main.tsx` and the poster viewer's `poster.ts`), a small shared module beside them.
- Depends on the posters change (#361) for the poster embed; branched from it.
- Docs: `docs/openwebui.md`, a line on the theme. No server, schema or route change.
