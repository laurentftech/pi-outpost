# Design: web-ui-context

## Context

The AgentSession is created once in `server/src/index.ts` with `appendSystemPrompt: config.appendSystemPrompt` — the injection point already exists. Assistant messages render through `ReactMarkdown` in `AssistantMessage.tsx` with only a `pre` component override; `FileViewer.tsx` already solved relative-link resolution (`resolveRelativeHref` + custom `a`) for viewer-internal navigation. File bytes currently travel only over the WS file-browser protocol, which rejects binary content — images need an HTTP path. Auth (shared token, `tokenValid`, WS `?token=`) landed just before this change and must gate any new endpoint.

## Goals / Non-Goals

**Goals:**
- Agent knows its output renders in this web UI and what it can reference.
- `![…](relative/path.png)` in an assistant message displays the image; file links open the FileViewer.
- One-click hide/show of tool cards, persisted.

**Non-Goals:**
- Live HTML artifact preview (iframe sandbox) — HTML files open in the FileViewer as source, like today. Revisit later if needed.
- Serving files outside the browser root, or write access over HTTP.
- Absolute-URL image proxying (external `https://…` images already render via plain `<img>`).
- Per-message or per-tool-type filter granularity — one global toggle.

## Decisions

- **Context block rides `appendSystemPrompt`** (prepended to the operator's entries at session creation, not stored in config). Alternatives: a `web-ui.md` file injected into the session context (pi-web's approach) — rejected because our SDK surface already exposes `appendSystemPrompt` and a file adds workspace pollution; an extension — overkill. The block is a constant in `server/src/index.ts`, versioned with the code.
- **Opt-out flag `webContext?: boolean`** (top-level config, default `true`). Injection is the right default — the whole point is that operators shouldn't need to know about it — but hosts with tightly curated prompts need the escape hatch.
- **`GET /files/raw?path=<rel>&token=<t>` HTTP endpoint** instead of extending the WS protocol with base64 frames. `<img src>` speaks HTTP natively; base64-over-WS would bloat memory, need client-side blob URLs, and complicate the reducer for zero gain. Confinement reuses `resolveConfined`/`isWithin` (same guarantees as the WS browser). Token in query mirrors the WS decision (`<img>` cannot set headers); same 1 MiB cap as the file browser; content type from a small extension map (png/jpeg/gif/webp/svg/avif), everything else `application/octet-stream` + `Content-Disposition: attachment` so an HTML file can never execute on the server origin.
- **SVG served as image is safe here** because `<img>` rasterizes SVG without running scripts; we never serve HTML inline (attachment disposition), so the origin can't be XSSed via workspace files.
- **Client resolution in `AssistantMessage`**: custom `img` and `a` ReactMarkdown components. Relative `src` → `/files/raw` URL (plus token when set); relative `href` → `onOpenFile(path)` opening the FileViewer (reusing FileViewer's resolution logic, extracted to a shared helper since messages resolve against the workspace root, not a viewed file's directory). Absolute URLs untouched.
- **Tool filter lives in App state + localStorage** (`pi-outpost:hide-tools`), toggle button in the conversation header area. Filtering skips ToolCard rendering in the message list rather than CSS-hiding — long sessions shouldn't pay layout cost for hidden cards. Agent activity remains visible through the existing working indicator and streaming text.

## Risks / Trade-offs

- [Context block token cost on every session] → keep it short (≤ ~150 words); it replaces flailing (agent printing image paths as code blocks) rather than adding noise.
- [Prompt-injection surface: block tells agent files render inline] → the block only describes UI capabilities, grants nothing; rendering is confined server-side regardless of what the agent writes.
- [Token leaks into `<img>` URLs in the DOM] → same exposure class as the WS URL, accepted with the auth design; URLs are same-origin and never navigated to.
- [Image > 1 MiB fails to render] → endpoint returns 413; `<img>` shows broken-image with a title tooltip; documented cap, consistent with the rest of the app.
- [Filter hides a tool card carrying an error] → errors already surface through the notifications banner, not only cards.

## Open Questions

None blocking. HTML iframe preview deliberately deferred (non-goal).
