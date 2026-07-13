# Pi Outpost

[![CI](https://github.com/laurentftech/pi-outpost/actions/workflows/ci.yml/badge.svg)](https://github.com/laurentftech/pi-outpost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.19-brightgreen)](https://nodejs.org)

**A web chat UI for the [pi coding agent](https://github.com/earendil-works/pi)** — run it as a standalone app, or embed it as a Shadow-DOM-isolated widget inside any web app. Built directly on pi's [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).

A Node server embeds a pi `AgentSession` and bridges it to a React chat UI over WebSocket: streaming responses, collapsible thinking blocks, live tool-execution cards (bash, edit, …), steering while the agent runs, and abort.

<p align="center">
  <img src="docs/screenshots/chat-light.png" alt="pi-outpost, light theme" width="49%">
  <img src="docs/screenshots/chat-dark.png" alt="pi-outpost, dark theme" width="49%">
</p>

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Production (single process)](#production-single-process)
- [Standalone configuration](#standalone-configuration)
- [Embedding](#embedding)
- [Architecture](#architecture)

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
- Embeddable widget (`@pi-outpost/embed`): mount into any web app, isolated via Shadow DOM (see below)

## Quick start

Requirements: Node ≥ 22.19 (what the pi SDK itself requires), and [pi](https://github.com/earendil-works/pi) configured (`~/.pi/agent/auth.json` or provider env vars like `ANTHROPIC_API_KEY`).

### Run it

```bash
npx pi-outpost init   # writes a starter pi-outpost.config.json here
npx pi-outpost        # serves the UI on http://127.0.0.1:3141/
```

pi-outpost never starts without a configuration file: the agent's working directory, its tools and its sandbox are decided there, and guessing them from whatever directory you happen to be standing in is not a decision anyone wants made for them. `init` writes the safe version of that file (read-only, no bash) for you to open up as needed.

### Develop against the repository

```bash
npm install
npm run dev
```

- Web UI: http://localhost:5173 (Vite dev server, proxies `/ws`, `/branding`, `/health` to the agent server)
- Agent server: ws://127.0.0.1:3141/ws

`npm run dev` passes the repository's committed [`pi-outpost.config.dev.json`](pi-outpost.config.dev.json) — the same code path, the same rule, no special case for developers.

### Tests

```bash
npm run test --workspace server        # integration tests: no model auth needed, no tokens spent
npm run test:live --workspace server   # drives real agent turns (needs model auth, costs tokens)
```

Each test boots a real server against a throwaway workspace (isolated `agentDir` — your sessions and
extensions are never touched) and talks to it over HTTP/WebSocket. See `server/test/README.md`.

> **Security note:** the server binds to `127.0.0.1` and validates the WebSocket `Origin` header. The agent has bash/edit/write tools — never expose this server on a network without the sandbox config below **and** an auth token: set `server.token` (or the `PI_OUTPOST_TOKEN` env variable, which wins) to a long random secret, e.g. `openssl rand -hex 32`. Binding off loopback without one is now **refused**, not merely discouraged: the WebSocket accepts connections with no `Origin` header (a local process already has shell access, so the check would be theatre), and with no token every request is valid — so `--host 0.0.0.0` alone would hand the agent to anything that can route to the host. Clients authenticate by opening `http://host:3141/?token=<secret>` once (stored locally, stripped from the URL) or via the embed widget's `token` option. Use a reverse proxy or Tailscale for transport encryption.

## Production (single process)

```bash
npm run start
```

Builds the web UI once (`web/dist`) and starts **one** Node process that serves the UI, `/ws`, `/branding`, and `/health` together on `server.port` (default `3141`) — nothing else to run or keep track of. Point a process manager (systemd, pm2, Docker `CMD`, …) at this one command; there's no separate dev server to start or stop.

Unlike `npm run dev`, this reads *your* configuration (`./pi-outpost.config.json`, or any of the locations below) — not the repository's dev config. With none, it refuses to start and says so.

Rebuild (`npm run build --workspace web`) and restart after any UI change — this mode has no hot reload, unlike `npm run dev` above.

Need to distribute a version that doesn't require Node.js installed at all (e.g. a Windows `.exe` for non-technical users)? See [`docs/sea-packaging.md`](docs/sea-packaging.md).

## Command line

```
pi-outpost [options]          start the server
pi-outpost init [options]     write a starter configuration file
pi-outpost config [options]   print the configuration that would be used, and where it came from
```

> **Upgrading from a pre-`0.1.0` clone?** Three behaviours changed. The server now **refuses to start without a configuration file** (it used to fall back to a plain local pi: your launch directory as workspace, full toolset, bash enabled) — run `pi-outpost init`. `PI_OUTPOST_PORT`/`PORT` now **override** `server.port` instead of being overridden by it, in line with `PI_OUTPOST_TOKEN`, which always won. And `PI_CWD` is now `PI_OUTPOST_CWD`.

| Flag | Effect |
|------|--------|
| `--config <path>` | Configuration file to use |
| `--profile <name>` | Use `<user config dir>/profiles/<name>.json` |
| `--cwd <dir>` | Directory the agent works in |
| `--agent-dir <dir>` | pi config/session store (default `~/.pi/agent`) |
| `--port <n>` / `--host <addr>` | Where to listen (default `127.0.0.1:3141`) |
| `-h, --help` / `-v, --version` | |
| `init --global` | Write to the user config directory instead of `./` |
| `init --force` | Overwrite an existing file |

There is deliberately **no `--token` flag**: a secret on the command line is readable by anyone who can list processes. Use `PI_OUTPOST_TOKEN` or the file's `server.token`.

## Standalone configuration

The server reads the **first** of these that exists, and only that one — configurations are never merged, so the file you are reading is the configuration that is running:

1. `--config <path>`
2. `--profile <name>` → `<user config dir>/profiles/<name>.json`
3. `$PI_OUTPOST_CONFIG`
4. `$PI_OUTPOST_PROFILE` → `<user config dir>/profiles/<name>.json`
5. `./pi-outpost.config.json` (the directory you launch from)
6. `<user config dir>/config.json`

`<user config dir>` is `$XDG_CONFIG_HOME/pi-outpost`, or `~/.config/pi-outpost`. A file you name explicitly must exist; the two implicit locations are simply skipped. Found nothing? The server refuses to start and tells you to run `pi-outpost init`.

Not sure which file won, or why a setting has the value it has? **`pi-outpost config`** prints the resolved configuration and the file it came from, without starting anything. Every start also logs the file it loaded and the sandbox it is actually enforcing.

**Profiles.** `--profile work` (or `$PI_OUTPOST_PROFILE`) reads `<user config dir>/profiles/work.json`. A profile is an ordinary config file — same keys, same rules — so `pi-outpost --profile work` from anywhere gives you the setup you configured once.

**Precedence.** For any setting that appears in more than one place: **flag > environment variable > config file > default**. Environment variables: `PI_OUTPOST_PORT` (falling back to `PORT`, which platforms inject), `PI_OUTPOST_HOST`, `PI_OUTPOST_CWD`, `PI_OUTPOST_AGENT_DIR`, `PI_OUTPOST_TOKEN`.

One exception, and it is deliberate: **a sandbox that grants write or bash, but names no `sandbox.root`, refuses a `--cwd`/`PI_OUTPOST_CWD` override.** Such a sandbox falls back to `cwd`, so an inherited variable (a shell profile, a CI job, a compose file) could otherwise turn "write inside my project" into "write inside `/`" without touching the file that granted it. Name the root, and the grant says what it covers. A read-only sandbox has no such hazard and simply follows the workspace.

See [`pi-outpost.config.example.json`](pi-outpost.config.example.json).

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
| `noSkills` | Disable skill discovery entirely. Needed for real isolation: even with a custom `agentDir`, skills also auto-load from `~/.agents/skills` (hardcoded to the real home directory) and from `.agents/skills` walked up from `cwd` to the git root — neither is scoped by `agentDir` |
| `noPromptTemplates` | Disable prompt template auto-discovery entirely (both `agentDir` and the project's `cwd/.pi/prompts`). Relevant when `cwd` points at a real project: it doubles as a resource-discovery root, so that project's own prompt templates load too unless disabled |
| `allowedModels` | Restrict the model switcher to these `{ "provider", "id" }` pairs. Without it, every built-in model whose provider has configured auth is listed — often more variants than a given deployment (e.g. an air-gapped internal endpoint) actually serves |
| `systemPrompt` / `systemPromptFile` | Replace pi's built-in system prompt entirely (mutually exclusive; `systemPromptFile` is a path to a text file). Project context files, skills, and `appendSystemPrompt` are still layered on top |
| `appendSystemPrompt` | Array of extra paragraphs appended after the (built-in or custom) system prompt |
| `webContext` | Inject a short web-UI context block into the system prompt so the agent knows its replies render in this UI (markdown, inline images, file links). Default `true`; set `false` for tightly curated prompts |
| `server.port` | Port to listen on (default `3141`). `--port` and `PI_OUTPOST_PORT`/`PORT` override it |
| `server.host` | Host to bind to (default `127.0.0.1` — only change this if you understand the security note above) |
| `server.allowedOrigins` | Extra exact Origins accepted on the WebSocket (embed the UI as a tab in another app) |
| `server.token` | Shared secret required on the WebSocket and `/branding` when set (`PI_OUTPOST_TOKEN` env overrides). Mandatory in practice when `server.host` is not loopback |
| `branding` | `title` (default `"π"`), `welcome` message, `accentColor` — applied by the web UI |
| `branding.defaultTheme` | `"light"` \| `"dark"` \| `"system"` (default) — used when the client has no stored preference |
| `branding.allowThemeToggle` | Show the theme toggle button (default `true`). Set `false` when embedding in a host app that drives the theme itself — see below |

### Theming

The UI ships with light and dark themes. Precedence: a local pick from the toggle button (persisted in `localStorage`) or an explicit override (the embed widget's `theme` option / `setTheme()`, or a host page's `postMessage`) beats `branding.defaultTheme`, which falls back to the OS preference (`"system"`).

Relative paths are resolved against the config file's directory.

## Embedding

`embed/` publishes `@pi-outpost/embed`, mounting pi-outpost into any element inside a **Shadow DOM** — fully isolated from the host app's CSS in both directions, React supplied as a peer dependency (not bundled), everything else (Tailwind, markdown/mermaid/highlight.js, the shared protocol types) compiled into the package.

```js
import { mount } from "@pi-outpost/embed";

const widget = mount(document.getElementById("assistant"), {
  serverUrl: "https://your-pi-outpost-server", // omit for same-origin
  theme: "dark", // optional; falls back to branding.defaultTheme, then "system"
});

widget.setTheme("light"); // change the theme at runtime
widget.unmount(); // tear down the React tree
```

Build it with `npm run build --workspace @pi-outpost/embed` (outputs ESM + CJS to `embed/dist/`, plus a rolled-up `.d.ts`), then publish `embed/` to your own registry.

Two things to configure on the server side regardless of deployment topology:

- **`server.allowedOrigins`**: the widget's WebSocket connection carries the *host page's* origin (e.g. `https://your-app.example.com`), not pi-outpost's own — add it explicitly, even same-domain deployments need this (only `localhost`/`127.0.0.1` are trusted automatically).
- **CORS**: `/branding` and `/health` are plain HTTP endpoints with no CORS headers. They work with zero extra config when the widget and the backend share an origin (recommended: reverse-proxy pi-outpost under your own domain). A genuinely cross-origin deployment needs a CORS layer in front — not built in yet.

A raw iframe (`<iframe src="https://your-pi-outpost-server">`) still works too, and still honors `branding.allowThemeToggle: false` plus the host-driven theme channel:

```js
iframeWindow.postMessage({ type: "pi-outpost:set-theme", theme: "light" }, "https://your-pi-outpost-origin")
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
