# Tasks: web-ui-context

## 1. Context injection (server)

- [x] 1.1 Add `webContext?: boolean` (default `true`) to `AppConfig` in `server/src/config.ts`; document in `pi-outpost.config.example.json` and README config table
- [x] 1.2 Write the web-UI context block constant (≤ ~150 words: markdown/math/mermaid rendering, workspace-relative file links open in viewer, relative image references display inline) and prepend it to `appendSystemPrompt` at session creation in `server/src/index.ts` when `webContext` is enabled

## 2. Raw file endpoint (server)

- [x] 2.1 `GET /files/raw` in `server/src/index.ts`: token check (query param or Bearer, `tokenValid`), confinement via `resolveConfined`/`isWithin` against the browser root (404 outside/missing), 1 MiB cap (413), image-extension content-type allowlist (png/jpg/jpeg/gif/webp/svg/avif), everything else `application/octet-stream` + `Content-Disposition: attachment`
- [x] 2.2 Endpoint test script (scratchpad): image 200 + content type, traversal/absolute 404, oversize 413, html attachment, 401 with token configured and missing/wrong token, 200 with valid token

## 3. Artifact rendering (client)

- [x] 3.1 Extract relative-reference resolution shared helper (from FileViewer's link logic) resolving against the workspace root; unit-usable by both FileViewer and AssistantMessage
- [x] 3.2 Custom `img` component in `AssistantMessage.tsx`: relative/workspace `src` → `/files/raw?path=…` (+`token` when set); absolute URLs untouched; graceful broken-image fallback
- [x] 3.3 Custom `a` component in `AssistantMessage.tsx`: workspace links open the FileViewer (thread `onOpenFile` from App), external links `target="_blank" rel="noreferrer"`
- [x] 3.4 Thread the auth token to the img URL builder (embed `explicitToken` included)

## 4. Tool-noise filter (client)

- [x] 4.1 `hideTools` state in App persisted to localStorage `pi-outpost:hide-tools`; skip ToolCard rendering in the message list when enabled (do not CSS-hide)
- [x] 4.2 Toggle button (conversation header area) with pressed state + aria-pressed + tooltip; verify working indicator stays visible while filtered

## 5. Verification

- [x] 5.1 Browser E2E: agent (or fixture message) references a workspace image → displayed inline; clicking a workspace file link opens the viewer; external link opens new tab; filter hides/restores tool cards and survives reload; with token configured, images still load
- [x] 5.2 Typecheck + `npm run build --workspaces --if-present`
- [x] 5.3 Code review agent pass; fix blocking findings
