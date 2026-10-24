# Design

## Context

Open WebUI 0.12.3 applies its theme by adding classes to its page's `<html>` (`src/routes/+layout.svelte`: `dark`, with `oled-dark` mapped to `dark`, `her` to light); it implements no MCP Apps host and posts no theme to frames (`ui/initialize`, `hostContext` absent from its build). A tool embed is a `srcdoc` frame: with "iframe Sandbox Allow Same Origin" on it has Open WebUI's origin and can read `parent.document`; otherwise it is opaque and reading throws. Today `openwebui/viewer/main.tsx` sets `data-theme="dark"` once from `prefers-color-scheme`; `openwebui/viewer/poster.ts` follows `prefers-color-scheme` and its changes.

## Decisions

### 1. One module, `openwebui/viewer/hostTheme.ts`

`followHostTheme(apply: (theme) => void): () => void` — reads `parent.document.documentElement.classList.contains("dark")` inside `try`; if it can, applies it and watches that element's `class` attribute with a `MutationObserver`; if it cannot, applies `prefers-color-scheme` and listens to its `change`. Returns a stop function. Both viewers call it: the planning viewer applies `data-theme`, the poster viewer `editor.setTheme`.

*Alternative*: Open WebUI's `localStorage.theme`. Rejected: it holds `system` for a user following the system, and is not updated live in the frame; the class on the page is what Open WebUI itself draws from.

### 2. Reading the parent, within the embeds' policies

Reading `parent.document` is a DOM access, not a request: the poster embed's policy (`connect-src 'none'`, scripts by hash) is unchanged, and the planning viewer's page loads nothing either. The embed only reads one class; it never writes to Open WebUI's page.

### 3. Shared poster save state

The Save control is owned by `@pi-outpost/posters/editor`, shared by Claude Desktop, pi-outpost and Open WebUI. It starts disabled, becomes enabled when the editor reports an unsaved change, and is disabled again after a successful save. A failed or stale save keeps the control enabled so the user can retry after resolving the reported issue.

## Risks / Trade-offs

- [Open WebUI changes how it marks its theme] → The fallback is the system's scheme, as today; a test pins the class it reads, and the guide names the Open WebUI version checked.
- [A frame nested deeper than Open WebUI's own] → Only the direct parent is read; anything else falls back to the system.
