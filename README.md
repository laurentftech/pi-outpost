# Pi Interface

Web UI for the [pi coding agent](https://github.com/earendil-works/pi), built on its [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).

A Node server embeds a pi `AgentSession` and bridges it to a React chat UI over WebSocket: streaming responses, collapsible thinking blocks, live tool-execution cards (bash, edit, …), steering while the agent runs, and abort.

<p align="center">
  <img src="docs/screenshots/chat-light.png" alt="pi-interface, light theme" width="49%">
  <img src="docs/screenshots/chat-dark.png" alt="pi-interface, dark theme" width="49%">
</p>

## Requirements

- Node ≥ 20
- [pi](https://github.com/earendil-works/pi) configured (`~/.pi/agent/auth.json` or provider env vars like `ANTHROPIC_API_KEY`)

## Run

```bash
npm install
npm run dev
```

- Web UI: http://localhost:5173 (Vite dev server, proxies `/ws`, `/branding`, `/health` to the agent server)
- Agent server: ws://127.0.0.1:3141/ws

The agent works in the directory the server is started from; override with `PI_CWD=/path/to/project`.

> **Security note:** the server binds to `127.0.0.1` and validates the WebSocket `Origin` header. The agent has bash/edit/write tools — never expose this server on a network without the sandbox config below.

## Production (single process)

```bash
npm run start
```

Builds the web UI once (`web/dist`) and starts **one** Node process that serves the UI, `/ws`, `/branding`, and `/health` together on `server.port` (default `3141`) — nothing else to run or keep track of. Point a process manager (systemd, pm2, Docker `CMD`, …) at this one command; there's no separate dev server to start or stop.

Rebuild (`npm run build --workspace web`) and restart after any UI change — this mode has no hot reload, unlike `npm run dev` above.

## Features

- Streaming chat (markdown, thinking blocks, mermaid diagrams)
- Tool execution cards with live output
- Steer / follow-up while streaming, abort
- Model + thinking-level selectors
- Session list / resume / new / delete
- Collapsible file-browser sidebar: lazy-loaded tree + read-only preview (syntax-highlighted, Markdown rendered), confined to the same root the agent's own tools can see; entries outside `sandbox.writableRoot` render dimmed
- Slash commands with autocompletion (`/` in the composer: extension commands, prompt templates, skills)
- File mentions with autocompletion (`@` in the composer: recursive name search over the browser root, inserts the relative path)
- Extension "Custom UI" support: dialogs, notifications, status/widgets, editor prefill (see below)
- Standalone mode: own config dir, file sandbox, branding (see below)
- Embeddable widget (`@pi-interface/embed`): mount into any web app, isolated via Shadow DOM (see below)

## Standalone configuration

Optional. Create `pi-interface.config.json` next to where you launch the server (or point `PI_INTERFACE_CONFIG` at a file). See [`pi-interface.config.example.json`](pi-interface.config.example.json). Without it, the server behaves like a plain local pi (user's `~/.pi/agent`, full toolset).

| Key | Effect |
|-----|--------|
| `cwd` | Agent working directory |
| `agentDir` | Own config dir (auth, models, settings, sessions) — fully separate from `~/.pi/agent` |
| `sandbox.root` | Read-only zone: read/ls/grep/find are confined to this directory, symlinks resolved. Defaults to `cwd` if omitted |
| `sandbox.allowWrite` | Adds edit/write, confined to `sandbox.writableRoot` (or the whole root if unset) (default `false`) |
| `sandbox.writableRoot` | Read-write zone: subdirectory of `root` that edit/write are further confined to. Must be inside `root`. Defaults to `root` itself |
| `sandbox.allowBash` | Adds bash — **not path-confined**, explicit opt-in (default `false`) |
| `tools` | Tool allowlist in non-sandbox mode, e.g. `["read","grep","find","ls"]` |
| `noExtensions` / `extensionPaths` | Disable extension discovery / load only listed extensions |
| `systemPrompt` / `systemPromptFile` | Replace pi's built-in system prompt entirely (mutually exclusive; `systemPromptFile` is a path to a text file). Project context files, skills, and `appendSystemPrompt` are still layered on top |
| `appendSystemPrompt` | Array of extra paragraphs appended after the (built-in or custom) system prompt |
| `server.port` | Port to listen on (default `3141`, or the `PORT` env var if set) |
| `server.host` | Host to bind to (default `127.0.0.1` — only change this if you understand the security note above) |
| `server.allowedOrigins` | Extra exact Origins accepted on the WebSocket (embed the UI as a tab in another app) |
| `branding` | `title` (default `"π"`), `welcome` message, `accentColor` — applied by the web UI |
| `branding.defaultTheme` | `"light"` \| `"dark"` \| `"system"` (default) — used when the client has no stored preference |
| `branding.allowThemeToggle` | Show the theme toggle button (default `true`). Set `false` when embedding in a host app that drives the theme itself — see below |

### Theming

The UI ships with light and dark themes. Precedence: a local pick from the toggle button (persisted in `localStorage`) or an explicit override (the embed widget's `theme` option / `setTheme()`, or a host page's `postMessage`) beats `branding.defaultTheme`, which falls back to the OS preference (`"system"`).

Relative paths are resolved against the config file's directory.

## Embedding

`embed/` publishes `@pi-interface/embed`, mounting pi-interface into any element inside a **Shadow DOM** — fully isolated from the host app's CSS in both directions, React supplied as a peer dependency (not bundled), everything else (Tailwind, markdown/mermaid/highlight.js, the shared protocol types) compiled into the package.

```js
import { mount } from "@pi-interface/embed";

const widget = mount(document.getElementById("assistant"), {
  serverUrl: "https://your-pi-interface-server", // omit for same-origin
  theme: "dark", // optional; falls back to branding.defaultTheme, then "system"
});

widget.setTheme("light"); // change the theme at runtime
widget.unmount(); // tear down the React tree
```

Build it with `npm run build --workspace @pi-interface/embed` (outputs ESM + CJS to `embed/dist/`, plus a rolled-up `.d.ts`), then publish `embed/` to your own registry.

Two things to configure on the server side regardless of deployment topology:

- **`server.allowedOrigins`**: the widget's WebSocket connection carries the *host page's* origin (e.g. `https://your-app.example.com`), not pi-interface's own — add it explicitly, even same-domain deployments need this (only `localhost`/`127.0.0.1` are trusted automatically).
- **CORS**: `/branding` and `/health` are plain HTTP endpoints with no CORS headers. They work with zero extra config when the widget and the backend share an origin (recommended: reverse-proxy pi-interface under your own domain). A genuinely cross-origin deployment needs a CORS layer in front — not built in yet.

A raw iframe (`<iframe src="https://your-pi-interface-server">`) still works too, and still honors `branding.allowThemeToggle: false` plus the host-driven theme channel:

```js
iframeWindow.postMessage({ type: "pi-interface:set-theme", theme: "light" }, "https://your-pi-interface-origin")
```

### Extension Custom UI

Extensions using pi's [Custom UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui) (`ctx.ui.select/confirm/input/editor/notify/setStatus/setWidget/setTitle/setEditorText`) work in the web UI: dialogs render as a modal, `notify()` as a toast, `setStatus()` as a header badge, `setWidget()` above/below the composer. The bridge binds with `mode: "rpc"`, mirroring pi's own RPC-mode protocol — so `ctx.hasUI` is `true` and dialogs get real answers, but TUI-only features (`custom()`, custom footers/headers/editors, terminal input, themes) have no web equivalent and are no-ops, same as RPC mode.

Custom messages (`pi.sendMessage()` with a `customType`, see [Message and Entry Rendering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#message-and-entry-rendering)) show up too, but without the extension's `MessageRenderer` — that returns a terminal `Component`, which has no browser equivalent. Instead it falls back to pi's own default look (violet card, markdown-rendered content), with any `details` payload collapsed behind a toggle (never verbose JSON by default). Messages sent with `display: false` stay hidden, same as in the TUI.

## Architecture

```
web/  (React + Vite + Tailwind)          server/  (Fastify + ws)
┌──────────────────────────┐             ┌─────────────────────────┐
│ useAgent (WS + reducer)  │  /ws JSON   │ AgentSession (pi SDK)   │
│ chat items: user /       │ ◄─────────► │ SDK events → lean wire  │
│ assistant / tool cards   │             │ events (shared/)        │
└──────────────────────────┘             └─────────────────────────┘
```

Sessions persist in `<agentDir>/sessions/` — reconnecting clients receive the full history (`hello` message).

Planned: fork/tree navigation, images.

## License

[MIT](LICENSE)
