# Scenario coverage — raw-files-follow-project

Capability: `api` (1 modified requirement). The requirement's eleven existing scenarios are
unchanged and keep the evidence recorded in the archived `serve-large-images` matrix; they are
re-listed here because a MODIFIED requirement restates them. Every server test runs a real server
through `server/test/harness.mjs` and speaks HTTP to it.

## api

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ServeImage | covered | `server/test/files-raw.test.mjs` — "serves an image with its content type". Unchanged. |
| ConfinementRefusal | covered | `server/test/files-raw.test.mjs` — "refuses to escape the workspace". Unchanged. |
| NonImageIsAttachment | covered | `server/test/files-raw.test.mjs` — "non-image files are downloads, never renderable on our origin". Unchanged. |
| PdfIsAttachment | covered | `server/test/files-raw.test.mjs` — "a PDF is a download too — the browser's own viewer never runs it here". Unchanged. |
| TokenRequired | covered | `server/test/files-raw.test.mjs` — "with a token configured, bytes need the token". Unchanged. |
| DnsRebindingBlocked | covered | `server/test/files-raw.test.mjs` — "a token-less server refuses a foreign Host (DNS rebinding)". Unchanged. |
| OversizeRejected | covered | `server/test/files-raw.test.mjs` — "refuses a non-image file over the 1 MiB cap". Unchanged. |
| ImageUnderThePdfLimit | covered | `server/test/files-raw.test.mjs` — "ImageUnderThePdfLimit: …". Unchanged. |
| ImageOverThePdfLimit | covered | `server/test/files-raw.test.mjs` — "ImageOverThePdfLimit: …". Unchanged. |
| PdfUnderItsOwnLimit | covered | `server/test/files-raw.test.mjs` — "serves a PDF above the 1 MB cap, under the PDF ceiling". Unchanged. |
| PdfOverItsOwnLimit | covered | `server/test/files-raw.test.mjs` — "a PDF over the configured PDF ceiling is still refused". Unchanged. |
| ServeFromTheNamedProject | covered | `server/test/files-raw.test.mjs` — "ServeFromTheNamedProject: a named project's image is read from that project's root". Two projects with different bytes under `shared.png`; the ids come from the WebSocket `hello` as the interface reads them. Asserts 200, `image/png` and the exact bytes of `figures/only-beta.png` from B, and each project's own `shared.png` bytes. Fails against the previous route (404 for B's file). |
| UnnamedReadsTheBootProject | covered | `server/test/files-raw.test.mjs` — "UnnamedReadsTheBootProject: …". Asserts the boot project's exact bytes and a 404 for B's file. |
| UnopenedProjectRefused | covered | `server/test/files-raw.test.mjs` — "UnopenedProjectRefused: …". An existing unopened directory holding `shared.png`, a subdirectory of an open project and an unknown id: each 404 with no PNG bytes in the body; a `../` path inside a named project is 404. Fails against the previous route (it ignored the name and served the boot project's file). |
| ClientNamesTheBoundProject | covered | `ui/src/components/FileViewer.test.tsx` — "asks the raw route for the file in the project the viewer shows" (a Windows root, decoded back from the URL) and "names the same project for an image a viewed Markdown file references"; `ui/src/components/AssistantMessage.test.tsx` — "asks for the image in the project the conversation runs in"; `ui/src/util/workspacePath.test.ts` — "names the project the path belongs to, encoded as a Windows root needs" and "rawFileWorkspace". The App wiring is checked in the running app below. |

## Running app

The built web UI was served by this branch's server, booted on project alpha with project beta
open, and driven with Playwright (Chromium). Read back from the DOM and the network:

- Switched to beta through the project selector, opened figures/plot.png from the tree: the
  <img> decoded (naturalWidth 120) and the preview attachment was built; report.md referencing
  it drew the image. Every /files/raw response was 200 and named beta. The same URL without
  workspace — what the interface built before — answers 404, the broken image reported.
- Monkey pass: same.png and r.md in both projects with different image sizes (31 px / 77 px);
  alternating switches four times, each project showed its own image in the viewer and in the
  Markdown file. Three switches fired without waiting, with an image open: the viewer was dropped,
  as a switch does, and the next Markdown file drew beta's image. No page error.
- Not exercised live: an image in an agent reply (no model in this environment); covered by the
  AssistantMessage test above, fed by the same rawWorkspace value as the viewer.
