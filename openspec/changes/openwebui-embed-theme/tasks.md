# Tasks

## 1. The shared theme source

- [x] 1.1 Write `openwebui/viewer/hostTheme.ts` (`followHostTheme`) with unit tests under jsdom: a readable parent with and without `dark`, a class change while open, an unreadable parent (throws) falling back to `prefers-color-scheme` and its change, and the stop function releasing both observers.

## 2. The embeds

- [x] 2.1 Use it in the planning viewer (`openwebui/viewer/main.tsx`, `data-theme`) and the poster viewer (`openwebui/viewer/poster.ts`, `editor.setTheme`). Rebuild both bundles; `openwebui` tests stay green.
- [x] 2.2 Add to `e2e/openwebui-posters.spec.ts` (and a planning case) a host page that marks itself `dark` as Open WebUI does: with the same-origin frame the embed is dark on a light system and follows a switch; with the default frame it follows the emulated system scheme. Covers the five scenarios.
- [x] 2.3 Check on the local Open WebUI 0.12.3 with the setting on: switch Open WebUI's theme with a planning and a poster open. One line in `docs/openwebui.md`.
- [x] 2.4 In the shared poster editor, keep Save disabled until an unsaved edit exists and after a successful save; label the formatting panel `Format`; verify in the pi-outpost browser flow and retain this behavior for every integration.

## 3. Closing

- [x] 3.1 Write `scenario-coverage.md`, run `npm run check:scenarios`, `openspec validate openwebui-embed-theme --strict`, lint and the openwebui suites.

## Workflow follow-up

- Rebase on `main` once #361 is merged; archive from `main` after this one merges.
