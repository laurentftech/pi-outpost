# Design

## Context

- `FileViewer.tsx` renders Markdown with `react-markdown`: relative links call `onReload` with the
  resolved path (open in the viewer), images load from `/files/raw` with the token in the query
  (`rawFileUrl`), and it offers rendered / source / split.
- `/files/raw` answers any non-image file as `application/octet-stream` with
  `Content-Disposition: attachment`, on purpose: "HTML above all must never execute or render on this
  origin". The token travels in the query string because `<img>` cannot send headers.
- The viewer already holds the file's text (the text preview protocol), and the draft while editing.

## Goals / Non-Goals

**Goals:** an HTML file renders like a Markdown file, with no choice asked of the user; the page cannot
act as the application.

**Non-Goals:** rendering HTML in chat messages; a page reaching other workspace files at run time
(`fetch("data.json")`); remote resources the page loads itself are left to the page.

## Decisions

### A sandboxed frame with an opaque origin

- **Choice:** `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcdoc=…>`,
  never `allow-same-origin`. The document is the file's text, prepared by the viewer.
- **Rationale:** with an opaque origin, the page's scripts cannot read the application's DOM, storage or
  cookies, nor call the server as the user: nothing they do needs the user's consent. Scripts are what
  makes a generated report work (charts), so they run, which is what "like Markdown" requires.
- **Rejected:** scripts off by default with a switch — the user asked for no choice. A path-based raw
  route serving HTML — it would make the server render HTML, which it refuses by design.

### Relative resources are written into the page, never linked

- **Choice:** before drawing, the viewer parses the page (`DOMParser`) and, for each reference that is
  relative (not a URL with a scheme, not `//…`, not `#…`, not `data:`), fetches the file through
  `/files/raw` itself and writes it in: a stylesheet as a `<style>` (its own relative `url()` resolved
  against the stylesheet and inlined), a script as an inline `<script>`, a picture (`img`, `source`,
  `video[poster]`, `link[rel=icon]`, SVG `image`, `srcset`, `style` attributes and inline `<style>`
  `url()`) as a `data:` URI. A reference that does not load is left as it is (a broken picture, as in
  a browser).
- **Rationale:** a `/files/raw` URL carries the token; written into the page, a script could read it and
  read any file of the workspace. Inlined, nothing in the page names the server or the token.
- **Bounds:** what `/files/raw` already bounds (1 MB for non-pictures, the PDF ceiling for pictures);
  each distinct file fetched once per rendering.

### Links leave through a message the viewer checks

- **Choice:** the viewer adds a small script to the page that intercepts clicks on links: a relative
  link posts `{ type: "pi-outpost:open", href }` to the parent; an anchor stays in the page; an absolute
  link opens in a new tab (`allow-popups-to-escape-sandbox`). The viewer accepts a message only from its
  own frame (`event.source`), and only to open the resolved workspace path in the viewer — the same thing
  a Markdown link does.
- **Rationale:** a relative link navigated inside the frame lands nowhere (the page has no address).

### Modes like Markdown

Rendered by default, source, and split while editing; the split pane draws the draft, debounced, as for
Markdown. Redrawing reloads the page, so its own state (scroll, script state) restarts.

## Risks / Trade-offs

- **A page can reach the network** (a CDN script, or sending what it shows somewhere). It reaches no
  more than what the file holds, as when the file is opened in a browser; it cannot reach the
  application or other files.
- **`fetch` of a sibling file by the page's own script does not work** (opaque origin, no route): left
  out, see Non-Goals.
