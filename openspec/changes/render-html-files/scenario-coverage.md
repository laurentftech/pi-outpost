# Scenario coverage — render-html-files

One capability, `file` (3 added requirements, 4 scenarios). Evidence:

- **In the running app:** `e2e/html-viewer.spec.ts` opens the seeded `index.html` page, written by
  `e2e/global-setup.ts` with a relative stylesheet, picture and script, a relative link, an anchor, and
  a probe script that reports from inside the page what it could reach.
- **The page preparation:** `ui/src/util/htmlPage.test.ts`.
- **The server's side of the isolation:** `server/test/files-raw.test.mjs`.
- **Destructive pass:** `scripts/probes/bench-html-page.mts` against `npm run bench` (`report/index.html`):
  rapid clicks on the page's script, a `top.location` escape, anchors down and up, an external link, a
  link to a missing file, switching files mid-preparation, modes toggled hard, the stylesheet removed
  from disk. It found that an anchor navigated the `srcdoc` frame to the application's address and left
  it blank; the link script now scrolls to the anchor itself, and the e2e checks the page survives it.

## file

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AnHtmlReportOpensRendered | covered | `e2e/html-viewer.spec.ts` — "AnHtmlReportOpensRendered: rendered with no choice asked, stylesheet, picture and script in place": the rendered mode is pressed on opening, the `h1` has the stylesheet's `rgb(1, 2, 3)`, the SVG picture decoded at its 40px width, `#written` holds "script ran", the source mode shows the markup, and no page error. `ui/src/util/htmlPage.test.ts` checks stylesheets with `@import` and `url()`, `srcset`, scripts with a literal `</script>`, and missing files left as written. |
| HtmlIsEditedBesideItsRendering | covered | `e2e/html-viewer.spec.ts` — "HtmlIsEditedBesideItsRendering: the rendering follows the draft": typing "Edited report" in the split editor shows it in the frame beside it, styled; leaving without saving shows the file's own text again. |
| ThePageCannotReachTheApplication | covered | `e2e/html-viewer.spec.ts` — "ThePageCannotReachTheApplication: opaque origin, no document, storage or cookie of the app, no token in the page": the page's own script reports `parent.document`, `localStorage` and `document.cookie` blocked and its origin `null`; the frame's `srcdoc` holds no `files/raw` and no `token=`; the sandbox is exactly `allow-scripts allow-popups allow-popups-to-escape-sandbox`. `ui/src/util/htmlPage.test.ts` — "puts no address of the server and no token in the page". `server/test/files-raw.test.mjs` — "non-image files are downloads, never renderable on our origin": `report.html` answers `application/octet-stream` as `attachment`. |
| ARelativeLinkOpensInTheViewer | covered | `e2e/html-viewer.spec.ts` — "ARelativeLinkOpensInTheViewer: a forged message opens nothing, the page's own link opens the file": the same `pi-outpost:open` message posted by the application's window leaves the page open; an anchor click keeps the page drawn; the page's relative link opens the seeded notes page rendered ("Site notes") and the frame is gone. |
