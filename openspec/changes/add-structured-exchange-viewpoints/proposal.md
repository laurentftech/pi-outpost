## Why

A model is rarely read whole. An architecture is read for its power distribution, then for its data
flows, then for what is safety-relevant — and today every one of those readings is rebuilt by hand.
A reader narrows a graph kind by kind in the key, and loses it on reload. The agent writing a report
passes `hide_element_kinds` and `hide_relationship_kinds` to `write_structure_figure` again for every
figure, and nothing records *why* a figure shows what it shows. The selection that makes a chapter
meaningful lives in nobody's document.

The use case this unlocks: ask the agent for a synthesis by domain, and get a Markdown report whose
chapters each explain one reading of the same model, each with its figure. The costly half of that —
producing a figure with no browser — has already shipped. What is missing is a way for the producer
to *name* a reading, say what it is for, and have both the reader and the agent use it.

## What Changes

- **Viewpoints join the version 2 contract, `urn:structured-exchange:2`.** Version 2 has not shipped
  in any release: it landed on main with #198 after v0.24.0 was cut, and no tag contains it. Adding
  one optional envelope field to it therefore changes nothing any producer has received, and avoids
  a third version whose only purpose would be this field. Version 1 is untouched, and a version 1
  document carrying viewpoints is still refused.
- **A viewpoint is a named inclusion over the graph vocabulary**: a stable `id`, a `label`, the
  `concern` it addresses, and the element and relationship kinds it retains. The name comes from
  ISO/IEC/IEEE 42010, where a viewpoint frames a concern and selects the model kinds that address
  it. "View" is deliberately not reused: this codebase already calls a figure or an export a view
  derived from a document.
- **Inclusion, not exclusion.** A viewpoint says what it is about. A kind added to the model later
  does not appear in the power viewpoint unannounced. Internally it resolves to the narrowing the
  reader and the figure tool already apply.
- **Validation refuses what a producer cannot have meant**: a viewpoint naming a kind the document
  does not contain, two viewpoints sharing an `id`, a viewpoint retaining nothing, and viewpoints on
  a document that is not a graph. Each is bounded by explicit ceilings.
- **The reader can select a viewpoint** in the rendering. Selecting one narrows the diagram to it;
  the key's type toggles still apply on top; the rendering says which viewpoint it shows and what
  concern it frames; and "the whole document" is always one choice away. Like any adjustment, a
  selection is presentation only.
- **The agent can name a viewpoint** when writing a figure: `write_structure_figure` accepts a
  `viewpoint` id, refuses one the document does not declare while listing the ones it does, and says
  in its result which viewpoint the figure shows.
- **A figure carries its viewpoint.** An exported or written figure states which viewpoint it shows,
  so a figure lifted out of its report still says what it is a reading of.

Out of scope, each named so it is not mistaken for forgotten:
- Viewpoints over tables and sequences. Graphs first; the shape leaves room for both.
- Viewpoints declared by a profile rather than by a document. That belongs to the profile registry,
  which is the next change, and the shape here is chosen so a profile can supply it unchanged.
- Remembering a reader's selected viewpoint across reloads.
- Freezing version 2. That belongs to the release that first ships it, as version 1 was frozen
  before version 2 was added.

## Capabilities

### New Capabilities

- `structured-exchange-viewpoints`: what a viewpoint is and where it may appear — its shape, bounds
  and semantic rules within the version 2 contract; its selection by a reader; its use by the agent's
  figure tool; and the guarantee that version 1 is untouched by its existence.

### Modified Capabilities

- `structured-exchange`: `ReaderMayAdjustAndNarrowTheView` gains selecting a declared viewpoint
  among the adjustments a reader may make, with the same presentation-only guarantee.
  `TheAgentCanWriteAFigureToAPath` lets the request name a declared viewpoint in addition to, or
  instead of, hidden kinds.

## Impact

- `shared/schemas/structured-exchange-2.json` — the optional `viewpoints` envelope property; the
  generated version 2 validator regenerated, and its drift check still passing.
- `shared/src/structuredExchange.ts` — viewpoint ceilings in the version 2 ceilings, and the mirrored
  type.
- `shared/src/structuredExchangeBounds.ts` — pre- and post-parse bounds for viewpoints.
- `shared/src/structuredExchangeValidation.ts` — the viewpoint semantic rules.
- `shared/src/structuredExchangeFigure.ts` and `structuredExchangeExport.ts` — resolving a viewpoint
  to a narrowing, and naming it in the figure.
- `ui/src/presentations/StructuredExchangeView.tsx` — the viewpoint selector.
- `server/src/structuredExchangeFigureTool.ts` — the `viewpoint` parameter;
  `server/src/structuredExchangeTool.ts` — the contract text the agent reads.
- `shared/conformance/` — valid and invalid version 2 cases for viewpoints; the version 1 lock runs
  unchanged.
- `skills/structured-exchange/SKILL.md`, `docs/structured-exchange.md` and the packaged contract —
  viewpoints documented and shipped.
- No protocol change: a document travels as it does today, and the selection never leaves the reader.
