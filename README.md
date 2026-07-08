# Pi Interface

Web UI for the [pi coding agent](https://github.com/earendil-works/pi), built on its [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).

A Node server embeds a pi `AgentSession` and bridges it to a React chat UI over WebSocket: streaming responses, collapsible thinking blocks, live tool-execution cards (bash, edit, …), steering while the agent runs, and abort.

## Requirements

- Node ≥ 20
- [pi](https://github.com/earendil-works/pi) configured (`~/.pi/agent/auth.json` or provider env vars like `ANTHROPIC_API_KEY`)

## Run

```bash
npm install
npm run dev
```

- Web UI: http://localhost:5173 (Vite dev server, proxies `/ws` to the agent server)
- Agent server: ws://127.0.0.1:3141/ws

The agent works in the directory the server is started from; override with `PI_CWD=/path/to/project`.

> **Security note:** the server binds to `127.0.0.1` and validates the WebSocket `Origin` header. The agent has bash/edit/write tools — never expose this server on a network without the sandbox config below.

## Features

- Streaming chat (markdown, thinking blocks, mermaid diagrams)
- Tool execution cards with live output
- Steer / follow-up while streaming, abort
- Model + thinking-level selectors
- Session list / resume / new / delete
- Slash commands with autocompletion (`/` in the composer: extension commands, prompt templates, skills)
- Standalone mode: own config dir, file sandbox, branding (see below)

## Standalone configuration

Optional. Create `pi-interface.config.json` next to where you launch the server (or point `PI_INTERFACE_CONFIG` at a file). See [`pi-interface.config.example.json`](pi-interface.config.example.json). Without it, the server behaves like a plain local pi (user's `~/.pi/agent`, full toolset).

| Key | Effect |
|-----|--------|
| `cwd` | Agent working directory |
| `agentDir` | Own config dir (auth, models, settings, sessions) — fully separate from `~/.pi/agent` |
| `sandbox.root` | File tools (read/ls/grep/find) are confined to this directory, symlinks resolved |
| `sandbox.allowWrite` | Adds edit/write, still confined to the root (default `false`) |
| `sandbox.allowBash` | Adds bash — **not path-confined**, explicit opt-in (default `false`) |
| `tools` | Tool allowlist in non-sandbox mode, e.g. `["read","grep","find","ls"]` |
| `noExtensions` / `extensionPaths` | Disable extension discovery / load only listed extensions |
| `server.allowedOrigins` | Extra exact Origins accepted on the WebSocket (embed the UI as a tab in another app) |
| `branding` | `title`, `welcome` message, `accentColor` — applied by the web UI |

Relative paths are resolved against the config file's directory.

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

Planned: fork/tree navigation, images, embeddable build.
