## Why

A PNG never displayed in a project other than the one the server booted with — neither opened from
the file tree nor referenced inline in a Markdown file or a reply: the browser drew a broken image.

The tree, the text preview and every other file operation go over the WebSocket, whose handlers
act on the project the connection is bound to. `/files/raw` — the only door for images and PDFs —
read from the module-level boot workspace whatever the client was looking at. The tree listed
`figures/plot.png` of project B; its bytes were then looked for under project A's root, which
answered 404. Reproduced against the running server: the URL the interface built answered 404,
the same path naming project B answers 200.

It surfaced on Windows because that is where several projects were open; nothing in it is
platform-specific.

## What Changes

- `/files/raw` takes an optional `workspace` query parameter: the `id` of an open project, as the
  snapshot reports it. Only projects already open are reachable; an unknown name answers 404 and
  never opens anything. Without the parameter the route keeps reading the boot project.
- The interface names its bound project on every raw URL it builds: image viewer, PDF viewer,
  Markdown images, reply images, preview attachments, Word export and conversation export.
- The workspace registry is declared before the HTTP server starts, so a request arriving during
  boot finds an empty registry rather than a binding in its temporal dead zone.

## Impact

- `server/src/index.ts` (`rawFileWorkspace`, the route, the registry's declaration).
- `ui/src/util/workspacePath.ts` (`rawFileUrl`'s `workspace` argument, `rawFileWorkspace`), `App.tsx`,
  `FileViewer.tsx`, `PdfViewer.tsx`, `AssistantMessage.tsx`, `DocxExportButton.tsx`, and the export
  modules.
- Tests: `server/test/files-raw.test.mjs`, `ui/src/util/workspacePath.test.ts`,
  `ui/src/components/FileViewer.test.tsx`, `ui/src/components/AssistantMessage.test.tsx`.
- Documentation: none — `/files/raw` is the interface's own route; README names it only for its
  authentication, which is unchanged.
