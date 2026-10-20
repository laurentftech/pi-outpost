## 1. Viewer

- [x] 1.1 Vendor `viewer-static.min.js` (pinned), licence, version; `scripts/update-drawio-viewer.mjs`.
- [x] 1.2 `DrawioFrame`: sandboxed frame, CSP, loaded once, posts the text, reports errors.
- [x] 1.3 The viewer's `.drawio` branch (rendered / split / source); "Open in draw.io".

## 2. Agent

- [x] 2.1 `drawio.ts`: read (plain and compressed pages) and check; tests.
- [x] 2.2 `drawio_check` tool, registered; tests.
- [x] 2.3 `skills/drawio/SKILL.md`.

## 3. Verification

- [x] 3.1 Running app: a real draw.io file, pages, split typing, a broken file, no network request; monkey pass.
- [x] 3.2 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, lint, suites; documentation.
