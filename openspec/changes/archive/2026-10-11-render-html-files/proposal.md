# Proposal

## Why

The file viewer renders Markdown, structured-exchange documents, images and PDFs, but shows an HTML
file only as its source. Agents write HTML reports, dashboards and exports; reading one means
downloading it or reading markup. The user wants an HTML file rendered when it is opened, exactly as
a Markdown file is: nothing to choose, nothing to allow.

## What Changes

- **An HTML file (`.html`, `.htm`) opens rendered**, with the same view modes as Markdown: rendered
  (the default), source, and rendered beside the source while editing.
- **The page is drawn as a browser would draw it**: its scripts run, and its stylesheets, pictures and
  scripts referenced by relative path, next to it in the workspace, are loaded.
- **Links behave as in a rendered Markdown file**: a relative link opens that file in the viewer, an
  absolute one opens in a new tab, an anchor scrolls the page.
- **Isolation, invisible to the user**: the page is drawn in a sandboxed frame with an opaque origin, so
  it cannot reach the application, its token or the server. Its relative resources are fetched by the
  viewer and written into the page, so no URL carrying the token ever enters it. The server still never
  serves HTML to render: `/files/raw` keeps answering an HTML file as an attachment.

## Capabilities

### Modified Capabilities

- `file`: `HtmlFilesAreRendered`, `ARenderedPageIsIsolated` and `LinksInARenderedPage` are added.

## Impact

- **`ui/src/components/`**: a component drawing the page; `FileViewer.tsx` treats HTML as a renderable
  file.
- **No server change.**
- **Bench:** `scripts/embed-bench.mts` seeds `report/index.html`; `scripts/probes/bench-html-page.mts`
  drives it destructively.
- **Docs:** `README.md` (the viewer's formats).
