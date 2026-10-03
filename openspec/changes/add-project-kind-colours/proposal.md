# Proposal

## Why

A kind's colour is chosen by hashing its name onto a fixed palette: stable, distinct within a document,
and meaningless. A programme that has always shown its reviews in red, or its system-engineering phases in
the colours of the planning tool everyone already reads, gets arbitrary colours instead — and the same
review may be red in one project and green in another for no reason anyone chose.

That convention belongs to the project, not to each document: a colour written into a timeline or a graph
is presentation in the data, which the structured-exchange contract excludes, and the agent would have to
restate it in every version of every document. The project already has a place for its own
structured-exchange settings — the registry at `.pi-outpost/structured-exchange.json`.

## What Changes

- **Registry format version 2** (`urn:structured-exchange-profile-registry:2`). Adds an optional
  `appearance` section mapping kind names to a colour, in two vocabularies — `kinds` (elements,
  participants, rows, timeline items) and `relationshipKinds` — and makes `profiles` optional, so a project
  can declare colours without declaring a data model. Version 1 registries are read exactly as before.
- **Project colours applied everywhere a kind is coloured**: graphs, sequences and timelines in the reader
  — tool results, structured-exchange blocks in replies, files opened in the viewer — and figures written
  by `write_structure_figure`. A kind the project names takes its colour; every other kind keeps the
  automatic one, which never reuses a declared colour shown in the same drawing.
- **Shown, not silently applied**: the legend marks a colour that comes from the project, and says so when
  two kinds shown together share a declared colour.
- **Read as it is now**: the server sends the project's appearance with each session snapshot and after
  every presented document, so editing the registry takes effect without a restart.
- Nothing changes in any structured-exchange document or in the document contract.

## Capabilities

### New Capabilities

- `structured-exchange-appearance`: a project's colour conventions for kinds — where they are declared,
  how they are validated, delivered and applied, and how the reader is told.

### Modified Capabilities

- `structured-exchange-profiles`: `AProjectDeclaresItsProfilesLocally` — the registry may be version 2,
  may declare `appearance`, and may declare no profile; a registry without profiles constrains no document.

## Impact

- **Formats**: new `shared/schemas/structured-exchange-profile-registry-2.json` (and its copy for the
  project-setup skill and the CLI package); registry validation and reading in
  `shared/src/structuredExchangeProfileValidation.ts` and `shared/src/structuredExchangeProjectRegistry.ts`.
- **Palette**: `assignTints` gains declared colours (`shared/src/structuredExchangePalette.ts`), used by the
  graph and sequence figures (`shared/src/structuredExchangeFigure.ts`) and the timeline view.
- **Protocol / server**: a project appearance message in `shared/src/protocol.ts`, sent by
  `server/src/index.ts` with snapshots and document announcements; `write_structure_figure` reads it.
- **UI**: `ui/src/useAgent.ts` holds it; `StructuredExchangeView`, `TimelineView`, the reply and file-viewer
  paths pass it to the drawing; legends mark project colours.
- **Docs**: `docs/structured-exchange-project-setup.md`, the `structured-exchange-project` skill.
- Depends on `add-structured-exchange-timeline` (timeline colours); no new dependency.
