# Design

## Context

See proposal.md. Constraints found in the code:

- Kind colours come from `assignTints(kinds)` in `shared/src/structuredExchangePalette.ts`: 16 tints × 4
  dash patterns, hashed by name, probing forward on a collision so two kinds in one drawing never share a
  presentation. Graph and sequence figures (`shared/src/structuredExchangeFigure.ts`) and the timeline view
  call it; the reader and `write_structure_figure` draw through the same figure code.
- The registry is read by `readProjectRegistry` (`shared/src/structuredExchangeProjectRegistry.ts`) and
  validated by `validateRegistry` against `structured-exchange-profile-registry-1.json`, published since
  v0.32 — so its shape cannot grow in place.
- Per-document conformance already travels from server to reader after each message
  (`announceStructuredConformance`, `announceReplyConformance` in `server/src/index.ts`; `structured_conformance`
  and `reply_structured_conformance` in `shared/src/protocol.ts`). The appearance is per project, not per
  document, so it needs one message, not one per card.

## Goals / Non-Goals

**Goals:** project-declared colours applied by every drawing path; no change to any document; legible
legends; edits effective without a restart.

**Non-Goals:**
- Colours in documents or per-document overrides.
- Shapes, dash patterns, line widths or fonts per kind; colour only.
- Colour by attribute value, by role, or by section.
- A colour picker in the UI, or per-reader colours.
- Dark-theme variants: drawings keep their light paper.
- Watching the registry file for changes outside a snapshot or a document (see D4).

## Decisions

### D1. Registry version 2, not a profile field and not a new file

Profiles are a data model the documents are *held* to; timelines are deliberately held to none, and kinds
like `SRR` would have to be declared in one to be coloured. A separate appearance file would be a third
project file with its own path, reader and format. The registry is already "this project's
structured-exchange settings", read on every check. So: `urn:structured-exchange-profile-registry:2` =
version 1 + optional `appearance`, with `profiles` optional (minItems 0, still required to be an array
when present). The reader dispatches on the declared identifier, as the document contract does.

Shape:

```json
"appearance": {
  "kinds": { "SRR": { "color": "#dc2626" } },
  "relationshipKinds": { "power": { "color": "#ea580c" } }
}
```

An object per kind (rather than a bare string) leaves room for later properties without another shape
change. `color` pattern `^#[0-9a-fA-F]{6}$`; each map at most 64 entries (`kindsPerVocabulary`); kind names
bounded like `kind` (100).

### D2. A malformed appearance makes the registry unusable

The alternative — ignore a broken appearance and keep the profiles — would make the registry half-valid,
a state the rest of the format never has, and a typo in a colour would silently change nothing. The
registry's existing rule ("unusable refuses everything") is kept: the fault is reported with file, rule and
pointer, and is fixed in seconds. Recorded as a risk below.

### D3. Declared colours enter `assignTints`; the renderer derives the rest

`assignTints(kinds, declared?: Map<string, string>)`: a declared kind gets `{ stroke: color, fill: mix(color,
white, 0.88), dash: undefined, declared: true }`; undeclared kinds probe as today, skipping any palette slot
whose stroke equals a declared colour present in the same call. Timeline bars already fill from the stroke
at 35 % opacity, so they need nothing more. Graph/sequence figure functions take an optional `appearance`
option and pass the right vocabulary's map. Two kinds sharing a declared colour keep it (D5 says so in the
legend) — recolouring one would override the project's own choice.

### D4. One appearance message per project, sent with snapshots and document announcements

New server → client message `{ type: "structured_appearance", appearance: ProjectAppearance | null }`.
Sent (a) right after every session snapshot and (b) together with every document/reply conformance
announcement, reusing the same registry read. The client stores the latest in state and passes it down
through a React context (as replies already do for conformance) to the document view, the timeline, the
reply view and the file viewer. `write_structure_figure` reads it directly from the registry it already
loads.

A save of the registry through the viewer's own `write_file` also re-sends it: the server
performed the write, so it needs no watcher to know — and that is where a person edits colours and
looks again. Found in the bench, where a saved colour stayed old until a reload.

Why not a file watcher: `server/src/fileWatcher.ts` watches only directories a client listed, by design,
to bound handles. A registry edit is followed in practice by presenting or reopening something, both of
which resend it; an edit with nothing redrawn shows on the next snapshot.

### D5. Legends say where a colour comes from

Graph/sequence key entries and timeline legend entries carry `data-colour-source="project"`, an accessible
name suffix "(project colour)", and a title. When two shown kinds share a declared colour, both entries
read "shares its colour with X".

## Risks / Trade-offs

- [A colour typo refuses every document in the project] → the refusal names the registry file, the rule
  and the pointer to the colour; documented in the project-setup guide.
- [A declared colour too close to another declared or automatic one] → only exact equality is detected;
  near colours are the project's choice. The dash channel is not applied to declared kinds, so two near
  declared colours are distinguished by name in the legend only.
- [Registry edits not seen until something is redrawn] → accepted (D4); stated in the docs.
- [Registry v1 frozen consumers] → v1 keeps its schema and meaning; the copy in the project-setup skill
  and the CLI package gain v2 beside it, and the schema tests hold both copies identical.

## Migration Plan

Additive. A project opts in by changing its registry's `schema` to version 2 and adding `appearance`.
Rollback: revert; a version 2 registry then reads as an unsupported format, which is the existing
refusal.
