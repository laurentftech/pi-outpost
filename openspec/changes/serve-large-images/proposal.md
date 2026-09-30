## Why

A PNG or a JPEG did not render at parity with an SVG. Every inline image — in a reply, in a viewed
Markdown file, in the image viewer, and in the HTML and Word exports — is loaded through
`/files/raw`, and that route refused any non-PDF file above 1 MiB. An SVG figure is a few kilobytes
of text and always passed; a photo or a screenshot is routinely several megabytes and came back
413, drawn as a broken image with no explanation.

Reproduced against the running server: a 423-byte PNG, a 917-byte JPEG and an SVG answered 200; a
5.6 MB PNG and a 1.3 MB JPEG answered 413.

## What Changes

- Files with an inline-image extension (png, jpg/jpeg, gif, webp, svg, avif) are measured against
  the PDF ceiling (`pdf.maxBytes`, default 25 MiB) instead of the 1 MiB preview cap. No new
  configuration key.
- Every other file keeps the 1 MiB cap, and the 413 still names the limit that was applied.
- Content types, confinement, authentication and the SVG CSP are unchanged.

## Impact

- `server/src/fileBrowser.ts` (`rawFileLimit`, `isRawImagePath`), `server/src/index.ts`,
  `server/src/config.ts` (doc comment).
- Tests: `server/test/files-raw.test.mjs`, `server/test/fileBrowser.test.ts`.
- Documentation: `README.md` — the `pdf.maxBytes` row now says images share the limit.
