# Tasks

## 1. Registry format version 2

- [x] 1.1 Add `shared/schemas/structured-exchange-profile-registry-2.json` (version 1 + optional `appearance` with `kinds` / `relationshipKinds` maps of `{ color: "#rrggbb" }`, ≤ 64 entries each, names bounded like `kind`; `profiles` optional); copy it beside version 1 wherever version 1 is shipped (`skills/structured-exchange/`, `cli` package via `scripts/check-cli-package.mjs`); verify the schema tests hold every copy identical and version 1 unchanged
- [x] 1.2 Dispatch `validateRegistry` on the declared registry identifier and return the appearance; in `readProjectRegistry`, read a registry with no profiles as constraining nothing while still exposing its appearance, and refuse a default with no registered profile; verify by tests for *AColourIsDeclaredForAKind*, *AMalformedColourMakesTheRegistryUnusable*, *AVersionOneRegistryIsUnchanged*, *ARegistryWithOnlyAnAppearanceConstrainsNothing*, *ADefaultNeedsARegisteredProfile*
- [x] 1.3 Verify every existing profile and registry test still passes unchanged (version 1 registries read exactly as before)

## 2. Palette and figures

- [x] 2.1 Extend `assignTints` with declared colours (derived fill, no dash, `declared` flag) and make undeclared kinds skip palette slots whose colour is declared in the same call; verify by unit tests including *AnUnnamedKindKeepsAnAutomaticColourDistinctFromDeclaredOnes* and *VocabulariesAreSeparate*
- [x] 2.2 Pass an optional appearance into the graph and sequence figure functions (element and relationship vocabularies) and into the timeline view; mark project-coloured legend entries and shared declared colours; verify figure tests for *AGraphElementTakesItsProjectColour*, *ALegendMarksAProjectColour*, *ASharedDeclaredColourIsSaid*, and that a figure without appearance is byte-identical to before (*NoAppearanceChangesNothing*)

## 3. Delivery

- [x] 3.1 Add the `structured_appearance` message to `shared/src/protocol.ts`; send it from `server/src/index.ts` after every snapshot and alongside document and reply conformance announcements (one registry read), `null` when the registry is absent, unusable or declares none; verify by server tests for *AnEditedRegistryRecoloursTheNextDocument* and *AnUnusableRegistrySendsNoAppearance*
- [x] 3.2 Hold the appearance in `ui/src/useAgent.ts` and provide it through a context to the document view, the timeline, reply blocks and the file viewer; verify by UI tests for *ATimelineMilestoneTakesItsProjectColour* and *TheDocumentIsUntouched* (envelope shown is the presented one)
- [x] 3.3 Make `write_structure_figure` use the registry's appearance; verify *TheFigureWriterUsesProjectColours* by reading the written SVG
- [x] 3.4 Re-send the appearance when the registry is saved through the viewer's `write_file` (found in the bench); verify *ARegistrySavedInTheViewerRecoloursAtOnce* in the wire test

## 4. Documentation

- [x] 4.1 Document registry version 2 and `appearance` in `docs/structured-exchange-project-setup.md` and the `structured-exchange-project` skill (including that a malformed colour makes the registry unusable, and when edits take effect); verify their fenced JSON validates with the documented-examples test

## 5. Integration

- [x] 5.1 Add a version 2 registry with an appearance to the bench's plain-server project, rebuild (`web`, `@pi-outpost/embed`, `build:e2e-host`), and drive it with Playwright: timeline, graph and file viewer show the declared colours and marked legends; edit the registry's colour, present again and read back the new colour; break the colour and read back the refusal; then monkey-test (edit while a drawing is enlarged, toggle compact and dependencies) and report what broke
- [x] 5.2 Write `scenario-coverage.md`, run `npm run check:scenarios`, `npm run lint`, typecheck, the server and UI suites, and `openspec validate add-project-kind-colours --strict`
