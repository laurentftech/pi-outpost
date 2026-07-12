# Proposal: web-ui-context

## Why

The agent doesn't know it is driving a web UI: it answers as if on a terminal, never references images or HTML it produces, and users can't see those artifacts anyway — the client only renders images the *user* sends. On long sessions, tool cards drown the actual conversation. Three gaps identified when comparing with pi-web, bundled here because the first two are coupled (the injected context tells the agent it *can* reference artifacts; the rendering makes that true) and the third is a cheap client-side win.

## What Changes

- **Web-UI context injection**: the server automatically appends a web-ui context block to the agent's system prompt at session creation (rides the existing `appendSystemPrompt` mechanism, prepended before the operator's own entries). The block tells the agent: responses render as markdown (with math and mermaid), workspace files can be linked and open in a viewer, images and HTML files it writes can be referenced by workspace-relative path and are displayed inline. Opt-out via config (`webContext: false`).
- **Artifact rendering in agent responses**: markdown in assistant messages resolves workspace-relative references — `![…](./plot.png)` renders the image inline, `[report](./report.html)` and other file links open in the existing FileViewer. Requires serving binary image bytes: new `GET /files/raw` HTTP endpoint confined to the browser root, size-capped, extension-derived content type, gated by the auth token (query parameter — `<img>` cannot send headers).
- **Tool-noise filter**: a conversation toggle that hides tool cards (persisted in localStorage). Streaming/working indicators stay visible so activity is never invisible.

## Capabilities

### New Capabilities

- `artifact-rendering`: how assistant-message markdown resolves workspace file references (inline images, viewer links) and the raw-file serving that backs it.
- `conversation-filter`: the tool-card visibility toggle and its persistence.

### Modified Capabilities

- `agent`: session initialization gains the injected web-ui context block (order relative to operator `appendSystemPrompt`, opt-out).
- `api`: new `GET /files/raw` endpoint (confinement, caps, content types, token gating consistent with the WS `?token=` scheme).

## Impact

- `server/src/config.ts`: `webContext?: boolean` (default true).
- `server/src/index.ts`: context block constant + prepend at session creation; `/files/raw` route (reuses `resolveConfined`/`isWithin` from `fileBrowser.ts`, `tokenValid`).
- `web/src/components/AssistantMessage.tsx`: custom `img` and `a` markdown components (same relative-resolution approach as FileViewer's link handling); needs the open-file callback threaded from App.
- `web/src/App.tsx` / `web/src/components/Header.tsx` or conversation header: tool-filter toggle state + localStorage.
- `web/src/components/ToolCard.tsx`: unaffected internally; rendering skipped upstream when filtered.
- No wire-protocol change (raw files go over HTTP, not WS). No breaking changes; all three features are additive and default-safe (context block is the only default-on behavior change).
