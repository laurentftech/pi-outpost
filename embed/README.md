# @pi-outpost/embed

Mount [pi-outpost](https://github.com/laurentftech/pi-outpost) — a web chat UI for the [pi coding agent](https://github.com/earendil-works/pi) — as a widget inside any web app.

The widget renders into a **Shadow DOM**, fully isolated from the host app's CSS in both directions: Tailwind's reset never touches the host page, and the host page's styles never bleed into the widget. React is a peer dependency (supplied by the host); everything else — Tailwind, markdown, mermaid, highlight.js, the wire protocol — is compiled into the package.

It talks to a pi-outpost server over WebSocket, so you need one running:

```sh
npx pi-outpost init   # writes a starter config
npx pi-outpost        # http://127.0.0.1:3141/
```

See the [configuration reference](../docs/configuration.md) for configuring it.

## Install

```sh
npm install @pi-outpost/embed
```

Requires `react` and `react-dom` ≥ 19 in the host app.

## Usage

```js
import { mount } from "@pi-outpost/embed";

const widget = mount(document.getElementById("assistant"), {
  serverUrl: "https://your-pi-outpost-server", // omit for same-origin
  theme: "dark", // optional; falls back to the server's branding.defaultTheme, then "system"
  token: "…", // only for servers with `server.token` set
  workspace: "/srv/projects/example", // optional resolved root of an already-open project
});

widget.setTheme("light"); // change the theme at runtime
widget.unmount(); // tear down the React tree
```

`mount(container, options?)` returns `{ unmount(), setTheme(theme) }`. The container itself stays in the DOM after `unmount()`, with an empty shadow root.

When `workspace` is set, the host binds that widget to the named open project and the widget
offers no project switcher. If the root is not open, the server falls back to its default
project rather than leaving the widget disconnected.

### Which theme wins

Strongest first:

1. `setTheme()`, a `{ type: "pi-outpost:set-theme", theme }` message, or the reader using the widget's own toggle — whatever was chosen while it was on screen;
2. the `theme` you pass to `mount()`. Naming it means you get it: a reader who once used the toggle on this origin does not overrule the page that embeds the widget;
3. a theme this browser remembered from an earlier visit;
4. the server's `branding.defaultTheme`, itself falling back to `"system"`.

So pass `theme` when your page has a look the widget has to match, and leave it out when the deployment's own `branding.defaultTheme` should decide.

The widget's theme menu offers **Light**, **Dark** and **System**. System follows OS
color-scheme changes and is remembered across visits. Set `branding.allowThemeToggle: false`
to hide this control when the host alone should choose the theme.

## Server-rendered apps

Importing the package is safe anywhere, but `mount()` needs a real DOM: it attaches a shadow root to the element you give it. In Next.js, Remix or Astro, call it from an effect (client-side only):

```jsx
useEffect(() => {
  const widget = mount(ref.current);
  return () => widget.unmount();
}, []);
```

In Next.js, the component doing this must be a client component (`"use client"`).

## Server-side configuration

Configure this on the pi-outpost server, whatever the deployment topology:

- **`server.allowedOrigins`** — the widget carries the *host page's* origin (e.g. `https://your-app.example.com`), not pi-outpost's own. Add it explicitly; even same-domain deployments need this (only `localhost`/`127.0.0.1` are trusted automatically). Listing it is all a cross-origin mount needs: the server answers those origins with the CORS headers the browser requires on every HTTP route, and applies the same allowlist to the WebSocket handshake. It grants no authority of its own — a token-protected route still wants its token.
- **`embed.workspaceControls`** — when the host does not pass `workspace`, choose what the
  widget exposes: `"settings"` (the one-project default), `"root"` (a compact root chooser)
  or `"projects"` (open/switch/close controls). `workspaceLock` still overrides this and
  pins the deployment to one project.

## License

MIT
