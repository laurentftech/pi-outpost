## Context

See proposal.md — Why. What constrains the approach:

- **Version 2 is unreleased.** `shared/schemas/structured-exchange-2.json` was added by #198 on
  2026-09-12. The last release, v0.24.0, was published on 2026-09-10, no tag contains the schema, and
  npm's `latest` is 0.24.0. Its envelope is closed (`additionalProperties: false`), which would make
  any addition a breaking change *once released* — and is exactly why the addition belongs before that
  release rather than after it.
- **Version 1 is frozen** by `shared/conformance/version-1.lock.json`, which pins each case by content
  digest and verdict, and validation is selected solely from the declared identifier
  (`CompatibleVersionedExtension`).
- **Version 2 has its own machinery**: ceilings (`STRUCTURED_EXCHANGE_CEILINGS_2`), bounds
  (`structuredExchangeBounds.ts`), a generated validator (`shared/src/generated/structuredExchangeCheck2.ts`)
  with a drift check against the committed schema, a conformance corpus, and derived views that treat an
  enriched document like its version 1 equivalent (`structuredExchangeV2DerivedViews.test.ts`).
- **Narrowing already exists, three times over, and speaks exclusion.** The reader's `Narrowing` is a
  set of `filterKey(scope, kind)` entries in `StructuredExchangeDocument`; the export takes
  `FigureNarrowing { hiddenElementKinds, hiddenRelationshipKinds }`; the agent's tool takes
  `hide_element_kinds` / `hide_relationship_kinds`. `shownGraph` drops a relationship whose endpoint
  is hidden, never hides a thing that declares no kind (`isHidden`), and keeps containers.
- **A figure already says when it is narrowed** — `graphFigure` builds the "Filtered view: …" statement
  and the proposal caveat into the SVG, which is what makes an exported figure honest.

## Goals / Non-Goals

**Goals:**

- One definition of what a viewpoint shows, shared by the reader, the export and the agent's tool, so
  the three cannot disagree — the same seam `graphFigure` already is for the picture.
- A shape a profile can supply unchanged later, so the profile registry adds a *source* of viewpoints
  rather than a second kind of viewpoint.
- Version 1 provably untouched, and every existing valid version 2 case still valid.

**Non-Goals:**

- Viewpoints over tables and sequences.
- Viewpoints contributed by a profile.
- Persisting a reader's selection.
- Any change to what an existing hide list means.
- Freezing version 2.

## Decisions

### D1 — Extend version 2, because nobody has it yet

A new identifier exists to protect producers who validate against a contract they already received.
Version 2 has not reached any: it is not in a release, not in a tag, not on npm. Adding an optional
envelope property to it now costs nothing downstream, where a version 3 would cost a schema, a generated
validator, dispatch, a ceilings object and a packaging entry — all to carry one field that version 2
would then never have.

*Alternative rejected: `urn:structured-exchange:3`.* Correct if version 2 had shipped; here it is a third
contract to keep true for no producer's benefit.
*Alternative rejected: carry viewpoints outside the document* (a sidecar file, or tool parameters only).
No contract change, but the reading stops travelling with the model, and the reader gets nothing — which
is half the need.

The window this relies on closes with the next release. Anything else that should reshape version 2
belongs in the same window, and version 2 should be frozen, as version 1 was, when it first ships.

### D2 — Envelope level, graph only, enforced as a semantic rule

`viewpoints` sits on the envelope beside `profile` and `target`, not inside `data`: it is about how the
document is read, not part of what it describes, and that is also where a profile-supplied equivalent
will resolve to. It is valid only when `kind` is `graph`. That constraint is enforced by a semantic rule
(`viewpoints-without-graph`) rather than a schema conditional, because `data` is already a `oneOf`
whose schema errors point at the wrong branch — version 2 had to discriminate on `kind` to report
usefully — and a rule names exactly what is wrong.

### D3 — The shape

```json
"viewpoints": [
  {
    "id": "power",
    "label": "Power distribution",
    "concern": "Where energy is stored, converted and consumed",
    "elementKinds": ["source", "converter", "load"],
    "relationshipKinds": ["power"]
  }
]
```

- `id` reuses the contract's `localId`; `label` and each kind reuse `label` and `kind`, so a viewpoint
  introduces no new string grammar.
- `concern` is **required**. A figure lifted out of its report has to say what it is a reading of, and
  a viewpoint without a concern is a filter with a name.
- `elementKinds` and `relationshipKinds` are each optional; at least one must be non-empty
  (`empty-viewpoint`). An absent list means that vocabulary is unconstrained.

The field names follow ISO/IEC/IEEE 42010 (viewpoint, concern) because this contract's users —
architecture and requirements tooling — already speak it.

### D4 — Inclusion resolves to the narrowing that already exists

`resolveViewpoint(data, viewpoint): Narrowing` computes, per vocabulary the viewpoint constrains, every
kind *present in the document* that the viewpoint does not retain, as `filterKey` entries. Everything
downstream — `shownGraph`, the figure, the export, orientation — then runs unchanged.

Two consequences, both deliberate:

- A thing with no kind stays visible, because `isHidden` never hides one. Inclusion could hide them,
  but then a viewpoint and a hand-built narrowing selecting the same kinds would draw different pictures,
  and the three-way seam this change relies on would have its first exception.
- Because resolution is computed against present kinds, "a kind added later is not shown" holds: a new
  kind is not in the retained set, so it is hidden.

### D5 — Refuse what cannot be meant, and never correct it

Four rules, named in the house style: `unresolved-viewpoint-kind`, `duplicate-viewpoint-identifier`,
`empty-viewpoint`, `viewpoints-without-graph`. A near-miss kind is refused, not matched to the closest
present kind — the same stance as a near-miss identifier. An unresolved kind is checked per vocabulary:
an element kind must be the kind of some element, a relationship kind the kind of some relationship.

This is the rule that differs for a profile later: a profile's viewpoint may legitimately name a kind a
given document lacks. The resolution in D4 already tolerates that; only this document-level rule
would not apply to it.

### D6 — Ceilings

Added to `STRUCTURED_EXCHANGE_CEILINGS_2` and enforced pre- and post-parse like every other bound:
viewpoints per document **20**, kinds per viewpoint bounded by the existing distinct-kinds ceiling,
`concern` **500** characters, `id` and `label` by their existing grammars. Twenty is generous for
readings a human selects from a control; a document with more is using viewpoints as data. The version 2
document byte ceiling is unchanged.

### D7 — The reader: selection seeds the narrowing, the key adjusts it

`StructuredExchangeDocument` gains `selectedViewpoint: string | undefined` beside `hidden`. Selecting a
viewpoint *replaces* `hidden` with its resolution; the key's toggles then edit `hidden` as they do today.
The rendering is "adjusted" whenever `hidden` differs from the selected viewpoint's resolution, which is
a comparison, not extra state to keep in sync. "Whole document" clears both.

The control is a native `<select>` next to the existing controls, offered only when viewpoints exist: it
is keyboard-accessible, reads its current value, and inherits the widget's theming inside the shadow
root without new focus management.

*Alternative rejected: selecting a viewpoint locks the key.* Simpler to explain, and it takes away the
one adjustment a reader already has.

### D8 — The figure states its viewpoint

`GraphFigureOptions` and `FigureNarrowing` gain an optional `viewpoint` ({ id, label, concern }). When
present, the statement inside the figure begins with the viewpoint's label and concern, followed by the
existing counts and proposal caveat, and says "adjusted" when further kinds are hidden. Export and tool
both call the same `graphFigure`, so D4 plus this is what makes a reader's figure and the agent's figure
identical for the same viewpoint.

### D9 — The tool: a `viewpoint` id, hide lists on top

`write_structure_figure` gains an optional `viewpoint` string. Resolution order: validate the document,
find the viewpoint (refuse with the declared ids, or with "declares no viewpoints"), resolve it, union the
request's hide lists into the narrowing, write. The result line names the viewpoint before the coverage
it already reports. The tool description teaches one figure per viewpoint, replacing its current advice
to pass hide lists per figure when the document declares viewpoints.

## Risks / Trade-offs

- **Version 2 changes after it is already on main.** → Nothing outside this repository depends on it;
  inside, the bench fixtures, e2e transcript and docs examples are exercised by the suites this change
  runs, and every existing valid version 2 conformance case must still pass unchanged.
- **The unreleased window is easy to forget.** → Stated in D1 and in the proposal's scope: version 2 is
  frozen by the release that first ships it, not later.
- **Producers keep emitting documents without viewpoints.** → The agent is the main producer;
  `present_structure`'s contract text and the skill show a viewpoint, and the refusal loop teaches the
  rules as it does today.
- **Kind-less things surviving every viewpoint may surprise.** → Consistent with every existing
  narrowing (D4), stated in the skill, and cheap to revisit when tables join, where untyped rows are the
  common case.
- **Selection plus key adjustments can drift far from the viewpoint.** → The rendering and the figure
  both say "adjusted", and "whole document" is one action away.
- **Auto-orientation may change when a viewpoint is selected.** → Expected: orientation is computed on
  what is shown, and a narrower selection is often a different shape. Turning remains the reader's.

## Migration Plan

Additive, to a contract no release carries. Version 1 producers change nothing; version 2 documents
without viewpoints are unchanged. Rollback is removing the property from the version 2 schema before it
ships.
