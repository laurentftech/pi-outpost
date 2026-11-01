# Integrations and extensions

[Home](../README.md) · [How-to](how-to.md)

- [pi-outpost in Open WebUI](#pi-outpost-in-open-webui)
- [Plannings in Claude Desktop](#plannings-in-claude-desktop)
- [Embedding](#embedding)

## pi-outpost in Open WebUI

The planning timelines and structured documents also run in [Open WebUI](https://openwebui.com),
without pi-outpost. A small server, shipped as a container image:
- keeps each user's plannings and shows them in the chat as the same interactive timeline;
- creates posters and saves a user's retouches as revisioned content the model can read;
- draws the model's diagrams, sequences, tables and proposals with pi-outpost's rendering;
- serves the model the same structured-exchange guide pi-outpost's agent reads;
- writes Word documents and PowerPoint decks, with Mermaid and structured-exchange diagrams and
  pictures, for the user to download from the chat.

A `docker-compose.yml` brings up Open WebUI with it for a demo. See
[docs/openwebui.md](openwebui.md) and its
[architecture and security](openwebui-architecture.md).

## Plannings in Claude Desktop

The planning timelines also run in Claude Desktop, free plan included, as an
[MCP App](https://github.com/modelcontextprotocol/ext-apps) installed by double-clicking one file:
- plannings are kept as readable files in a folder you choose, with every earlier version beside them;
- they are drawn in the conversation as the same interactive timeline, compared with any earlier version;
- click a task or a milestone, then ask Claude to change "it".

Download `pi-outpost-plannings.mcpb` from the [latest release](https://github.com/laurentftech/pi-outpost/releases/latest).
See [docs/claude-desktop.md](claude-desktop.md).

## Embedding

`embed/` publishes `@pi-outpost/embed`, mounting pi-outpost into any element inside a
**Shadow DOM** — fully isolated from the host app's CSS in both directions, React supplied as
a peer dependency, everything else compiled into the package.

```js
import { mount } from "@pi-outpost/embed";

const widget = mount(document.getElementById("assistant"), {
  serverUrl: "https://your-pi-outpost-server", // omit for same-origin
  theme: "dark",          // optional; falls back to branding.defaultTheme, then "system"
  token: "…",             // optional; a host that already authenticates its user sees no token screen
  workspace: "/srv/projects/acme", // optional; which project this widget shows
});

widget.setTheme("light"); // change the theme at runtime
widget.unmount();         // tear down the React tree
```

Which project a widget shows is the **host's** decision: `workspace` names it by its
resolved root, and a root that is not open falls back to the default rather than failing.
What the widget offers *around* it is the server's decision, via
`embed.workspaceControls`: `settings` (the default — one project, sandbox root editable
through Settings only), `root` (a compact root chooser in the header) or `projects` (the
open/switch/close controls the standalone app has). A `workspaceLock` on the server
suppresses project controls whatever the policy says.

Two things to configure server-side, whatever the topology:

- **`server.allowedOrigins`**: the widget's WebSocket carries the *host page's* origin, not
  pi-outpost's — add it explicitly. Even same-domain deployments need this; only
  `localhost`/`127.0.0.1` are trusted automatically
- **CORS**: an origin listed there also receives CORS headers on the HTTP endpoints
  (`/branding`, `/health`, `/files/raw`, `/files/docx-template`, the static app), so a genuinely cross-origin widget
  works without a proxy in front. The allowlist is the whole of it

A raw iframe (`<iframe src="https://your-pi-outpost-server">`) still works too, and honours
`branding.allowThemeToggle: false` plus the host-driven theme channel:

```js
iframeWindow.postMessage({ type: "pi-outpost:set-theme", theme: "light" }, "https://your-pi-outpost-origin")
```

### Extension Custom UI

Extensions using pi's [Custom
UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui)
(`ctx.ui.select/confirm/input/editor/notify/setStatus/setWidget/setTitle/setEditorText`) work
in the web interface: dialogs render as a modal, `notify()` as a toast, `setStatus()` as a
header badge, `setWidget()` above or below the composer. Status badges preserve ANSI
foreground colours and text styles, including in the overflow list; hover titles use plain text.
Extensions using `ctx.ui.theme.fg()` (for example pi-blackhole's gauges) receive the SDK's
built-in dark theme rather than unstyled text, falling back to its generated system theme
in standalone bundles where SDK theme files are unavailable. Both truecolor and indexed ANSI foregrounds
are rendered; this does not enable switching the interactive terminal theme from the browser.
The bridge binds with `mode: "rpc"`,
mirroring pi's own RPC-mode protocol — so `ctx.hasUI` is `true` and dialogs get real answers,
while TUI-only features (`custom()`, custom footers/headers/editors, terminal input, themes)
are no-ops, same as in RPC mode.

Custom messages (`pi.sendMessage()` with a `customType`) show up too, without the extension's
terminal `MessageRenderer`: they fall back to pi's own default look, with any `details`
payload collapsed behind a toggle. Messages sent with `display: false` stay hidden, as in the
TUI.

### Reporting progress from a tool

A long-running tool can report how far along it is. From `execute`, call `onUpdate` with a
`progress` fraction between `0` and `1` in `details` — the same call you already make to
stream partial output:

```ts
async execute(toolCallId, params, signal, onUpdate) {
  for (let i = 1; i <= steps; i++) {
    await doOneStep();
    onUpdate?.({ content: [{ type: "text", text: `step ${i}/${steps}` }], isPartial: true, details: { progress: i / steps } });
  }
  return { content: [{ type: "text", text: "done" }] };
}
```

The interface then shows a determinate bar on the tool card while the call runs. It is a
hint: a value outside `0..1` is clamped, the bar appears once the first fraction arrives and
disappears when the tool finishes, and a tool that reports nothing looks exactly as it did.
