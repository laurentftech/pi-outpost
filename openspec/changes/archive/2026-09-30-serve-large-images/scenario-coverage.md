# Scenario coverage — serve-large-images

Capability: `api` (1 modified requirement, 11 scenarios). Every test runs a real server through
`server/test/harness.mjs` and speaks HTTP to it, except the last row's unit test, which pins the
extension table the route and `readFileRaw` share.

## api

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ServeImage | covered | `server/test/files-raw.test.mjs` — "serves an image with its content type". Asserts 200, `image/png`, `nosniff` and the byte length. Unchanged by this change. |
| ConfinementRefusal | covered | `server/test/files-raw.test.mjs` — "refuses to escape the workspace". Asserts 404 and no `SECRET` in the body for `..`, encoded `..`, and absolute paths. Unchanged. |
| NonImageIsAttachment | covered | `server/test/files-raw.test.mjs` — "non-image files are downloads, never renderable on our origin". Asserts `application/octet-stream` and `attachment`. Unchanged. |
| PdfIsAttachment | covered | `server/test/files-raw.test.mjs` — "a PDF is a download too — the browser's own viewer never runs it here". Unchanged. |
| TokenRequired | covered | `server/test/files-raw.test.mjs` — "with a token configured, bytes need the token". Asserts 401 without or with a wrong token, 200 with the query token and with a Bearer header. Unchanged. |
| DnsRebindingBlocked | covered | `server/test/files-raw.test.mjs` — "a token-less server refuses a foreign Host (DNS rebinding)". Unchanged. |
| OversizeRejected | covered | `server/test/files-raw.test.mjs` — "refuses a non-image file over the 1 MiB cap". A 1.1 MB `big.txt`: asserts 413 and `limit` = 1 048 576. Also `server/test/fileBrowser.test.ts` — "still refuses an oversized file". |
| ImageUnderThePdfLimit | covered | `server/test/files-raw.test.mjs` — "ImageUnderThePdfLimit: serves a PNG and a JPEG above the 1 MB cap, under the PDF ceiling". Asserts 200, `image/png` / `image/jpeg`, and the full byte length of each 2 MB file. Fails against the previous code (both answered 413). |
| ImageOverThePdfLimit | covered | `server/test/files-raw.test.mjs` — "ImageOverThePdfLimit: an image over the configured PDF ceiling is refused, naming that ceiling". A server with `pdf.maxBytes` = 1 MiB: asserts 413 and the `limit` it reports. `server/test/fileBrowser.test.ts` — "an image is measured against the PDF ceiling, like a PDF, whatever the extension's case" pins every allowlisted extension (and upper case) to the PDF ceiling, and `.md`, `.html`, `png`, `photo.png.txt` to 1 MiB. |
| PdfUnderItsOwnLimit | covered | `server/test/files-raw.test.mjs` — "serves a PDF above the 1 MB cap, under the PDF ceiling". Unchanged. |
| PdfOverItsOwnLimit | covered | `server/test/files-raw.test.mjs` — "a PDF over the configured PDF ceiling is still refused". Unchanged. |

## Running app

The built web UI was served by this branch's server and driven with Playwright (Chromium). A
workspace held a 423-byte PNG, a 917-byte JPEG, a 4.9 MB PNG, a 1.4 MB JPEG and an SVG, and a
Markdown file referencing all five. Read back from the DOM (`naturalWidth` of each `<img>`):

- Markdown viewer: all five decoded (200, 200, 1400, 1400, 200 px wide). Before the change the two
  large ones answered 413 at `/files/raw`.
- Image viewer, opening `small.jpg`, `big.png` and `big.jpg` directly: each decoded.
- Monkey pass: twelve rapid clicks cycling between a large PNG, a large JPEG and the Markdown file,
  then a double click — the viewer settled on the last file clicked, drawn. A referenced image
  deleted on disk under the running app showed as a broken image beside the one that still exists,
  the app stayed mounted, and no page error was raised.
