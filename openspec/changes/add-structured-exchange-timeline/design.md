# Design

## Context

See proposal.md for motivation. What shapes the approach:

- The contract is versioned by its identifier and each version is frozen once released:
  `shared/conformance/version-1.lock.json` and `version-2.lock.json`, held by
  `server/test/structuredExchangeFrozenVersions.test.ts`. A new kind is therefore a version 3.
- Validation runs in two stages everywhere: the committed JSON Schema (TypeBox `Compile` on Node in
  `shared/src/structuredExchangeSchemaNode.ts`, a generated boolean check for the browser in
  `shared/src/generated/`), then semantic rules in `shared/src/structuredExchangeValidation.ts` that
  name a rule and a JSON Pointer. `schemaFor` narrows `data` to one `oneOf` variant by a marker
  property, purely to sharpen diagnostics.
- Kind dispatch is explicit `if (kind === …)` in a dozen places (validation, digest, role tally,
  textual equivalent, Mermaid, document items, profile check, figure export, the reader view). A new
  kind must be added to each or fall into a table branch by default — several `else` arms assume
  "not graph, not sequence ⇒ table".
- Graph and sequence geometry is computed by pure functions in `shared/src/structuredExchangeModel.ts`
  (`layoutGraph`, `layoutSequence`) and drawn by React; text widths come from the deterministic
  estimator in `shared/src/structuredExchangeText.ts`, not from DOM measurement.
- Colours by kind come from `shared/src/structuredExchangePalette.ts`, bounded by
  `kindsPerVocabulary` (64).

## Goals / Non-Goals

**Goals:**

- A version 3 contract that is version 2 plus `timeline`, reachable from every surface that accepts a
  structured-exchange document today.
- A renderer whose geometry is a pure, testable function of `(data, today, metrics)`.

**Non-Goals:**

- Proposals, approval or application of timelines; editing in the view.
- Scales other than `month`, zoom, automatic scale choice.
- Hierarchical groups, progress, baselines, extra reference lines, extra item types.
- Dependency lag/lead, scheduling (moving dates to satisfy dependencies), critical-path computation.
- Exporting a timeline as SVG, PDF, image or spreadsheet; the reader's diagram/table export controls
  are not offered for a timeline.
- Version 2 enrichment (attributes, locations, artifacts, expectations) on tasks or items.
- Profile constraints on timeline kinds.

## Decisions

### D1. Version 3 is version 2 plus one `data` variant

`structured-exchange-3.json` is a copy of version 2 with `$id` changed, `kind` gaining `"timeline"`,
and a fourth `data` branch. Every version 2 construct keeps its definition, so a version 2 document
re-declared as version 3 means the same thing (spec: *AVersionTwoDocumentMeansTheSameUnderVersionThree*).
The semantic validator treats version 3 as version 2 for every existing kind, keyed on "enriched
version" (≥ 2) rather than equality with the version 2 identifier — every `=== STRUCTURED_EXCHANGE_SCHEMA_V2`
test is audited (e.g. `proposableKinds`, which becomes graph/sequence/table for 2 and 3, never timeline).

*Alternative:* a separate `urn:structured-exchange-timeline:1` contract. Rejected: it would need its own
tool, reply-block recognition and conformance tooling, which is the "separate transport" the request
rules out.

*Consequence:* the conformance case `unknown-version` currently uses the version 3 identifier; it moves
to version 4, recorded in `version-1.lock.json` with a `changedAfterFreeze` reason, exactly as the
README describes for its previous move.

### D2. Field names follow the contract's existing split between `type` and `kind`

The request's shape is kept almost verbatim inside `data`: rows and items are discriminated by `type`
(structural, closed enum — as a removal's `type` already is), while `kind` stays the opaque domain
vocabulary (`SRR`, `PDR`). The envelope's own `type: "timeline"` from the request becomes the
envelope's `kind: "timeline"`, and `title` moves into `data`, because every envelope today is
`{schema, kind, data}` and a top-level `title` would be a construct no other kind has.

Items get an optional `id`, unique together with task ids: it is what a dependency names. An item
without one simply cannot be a dependency endpoint.

The schema's `data` marker for `schemaFor` narrowing is `time`; `NARROWABLE_KINDS` gains `timeline`.

### D3. Ceilings

Added to a `STRUCTURED_EXCHANGE_CEILINGS_3` constant and mirrored in the schema, held by the existing
schema/constant drift test: `timelineRows: 500`, `itemsPerTask: 100`, `title` bounded like `label`;
`id`, `label`, `kind` reuse `localId`, `label`, `kind`; `dependencies: 2000`, the bound version 2
already uses for a table's relations. No ceiling on the range's duration: the date
pattern (four-digit year) is the only bound, as the request asks.

### D4. Out-of-range items are refused, not clipped

The request leaves this to the implementation. Refusing (`item-outside-range`, message stating the
range) matches the rest of the contract — a document that would be drawn misleadingly is refused,
never partly drawn — and the fix for the agent is one obvious edit to `time`. Clipping would show a
bar that appears to start on the range edge, which is a date the plan never said.

### D5. Today: local calendar date, out-of-range marker on the header edge

`today` is the reader's local calendar date (`getFullYear/getMonth/getDate`), converted once to a
day number; all layout arithmetic is in UTC day numbers parsed from `YYYY-MM-DD`, so no time zone
reaches a position (spec: *TimeZoneDoesNotMovePositions*). The view passes `today` into the layout;
tests inject it. When outside the range, the layout returns `{ today: "before" | "after" }` and the
view draws a small header marker at that edge (D4's reasoning: never a fabricated position). The view
recomputes `today` when it mounts; a document left open across midnight keeps the earlier day until
it re-renders — acceptable, noted below.

### D6. Pure layout in `shared/`, HTML shell + SVG body in the UI

New `shared/src/structuredExchangeTimeline.ts`:

1. **Scale** — `dayNumber(date)`, `x(day) = (day − startDay) × pxPerDay` with a fixed `pxPerDay` for
   the month scale (≈ 4 px/day, ~120 px/month). Activity spans `[start, end + 1)`; milestone at
   `day + 0.5`. Header: year bands and month bands from calendar boundaries.
2. **Row layout** — rows in order; a separator gets a fixed height; a task gets
   `lanes × laneHeight` (≥ 1 lane).
3. **Annotation placement** — per task, every item yields a glyph extent (bar or star) and, when it
   has text, a label extent measured with `structuredExchangeText`'s estimator. An activity label that
   fits inside its bar is placed inside (consumes no extra space). Otherwise labels are placed to the
   right of their glyph and assigned greedily, in date order, to the first lane where they intersect
   no glyph or label already placed — interval scheduling, deterministic, O(n·lanes). This satisfies
   *CrowdedAnnotationsDoNotOverlap* by construction and is unit-testable without a DOM.
4. **Output** — a plain geometry object (header bands, month lines, rows with y/height, items with
   rects/points and label boxes, today line or edge marker, legend kinds).

`TimelineView` in `StructuredExchangeView.tsx` renders a two-column grid: a fixed task-label column
(HTML) and a horizontally scrolling container holding one SVG with header, month lines, rows, items
and the today line. Because header, rows and today line live in the same scrolled SVG, alignment
during scroll is structural rather than synchronised (spec: *ScrollingKeepsTodayAligned*). The
timeline grows in height with its rows rather than scrolling vertically, so the header needs no
vertical stickiness (a sticky header inside a horizontal scroller sticks to that scroller, not to
the page, and would do nothing).

Found in the running app and added during implementation:

- **Opens on today.** A plan wider than its viewport opened on its first month, with Today a
  scroll away. On mount only, the scroller brings Today to about a third of its width; after
  that the scroll position is the reader's.
- **The year repeats each quarter** in the header, so a scrolled view never shows months without
  a year.
- **Keyboard focus is drawn** as a dashed ring round the glyph: an SVG group has no outline.
- **The rows SVG is a `group`**, not the default image: Chromium exposed it as an image whose
  children are presentational, hiding every item button from assistive technology.
- **Milestones sit on or below their activities, never above.** Bars are placed first, then
  milestones, each in date order; a milestone takes the bars' line when it has room and a line
  below otherwise. Placed purely by date, a review falling before the next phase took the top
  line and pushed that phase under it (reported by the user as reading upside down).
- **Reader display options**, asked for by the user once the first version ran: hide dependency
  arrows (the timeline says they are hidden, and selection and text still list them), and one row
  per section — a separator and its tasks folded onto one row titled by the separator, laid out with
  the same lane rules, tasks before the first separator keeping their rows, an unlabelled activity
  annotated with its task's name. Both are layout options and component state; neither touches the
  document or the contract.
- **Neighbours on one lane** (a bar and the star on the day after it) are joined by a straight
  arrow instead of the orthogonal route, which looped under the bar.
- **Refusal wording** for a timeline: `kind-not-proposable` says to present the revised timeline
  rather than calling it a projection, and the figure and table writers point at
  `present_structure` instead of at each other.
- **Schema diagnostics** for a timeline name the property at fault: rows and items are dispatched
  by `type` with `if`/`then`, and a failed branch is re-asked of its own definition; extra
  properties are refused one by one at their own pointer; enumerations list the allowed values.
  A version 3 document of any other kind is explained by version 2's validator, so its
  diagnostics are exactly version 2's.

*Alternative:* CSS grid with a column per month. Rejected: months become categorical columns, which
is exactly what the request forbids, and proportional days would need fractional spanning anyway.

*Alternative:* render the label column inside the SVG and synchronise scroll. Rejected: two scroll
positions to keep in step is the kind of transition defect this project keeps finding.

### D7. Kind colours from the existing palette, one vocabulary for items

Activities and milestones share one vocabulary (a `kind` means the same thing on either), assigned
through the same palette function graphs use, so the same `kind` string always gets the same colour
within a document. The legend lists kinds in first-appearance order. Unkinded items use the neutral
token. "Configurable" in the request is met by keeping the mapping in the renderer; a user-facing
palette editor is out of scope.

### D8. Inspection reuses the document's existing selection idiom

Items are focusable SVG groups (`tabindex="0"`, `role="button"`, `aria-label` with task, type, dates,
label, kind). Click or Enter selects; a details strip under the timeline shows the fields; Escape or
selecting again clears. The today line and separators are not focusable.

### D9. Every kind dispatch gets an explicit `timeline` arm

Rather than relying on `else` branches, each dispatch site listed in Context gets an explicit arm, and
the existing "table by default" `else` arms are turned into explicit `table` arms so a future kind
fails loudly. Figure and table export return a dedicated refusal (`not-drawable` style, mirroring the
existing table refusal in `structuredExchangeExport.ts`). The profile check returns `unconstrained`
for a timeline, as for a sequence. Mermaid returns `undefined` for a timeline (no Mermaid equivalent
offered).

### D10. Dependencies are one list on `data`, resolved to ends, judged but never enforced

**Shape.** `data.dependencies: [{ from, to, type? }]`, endpoints by `id`, rather than `predecessors`
on each item as the request's future-extension sketch showed. One list is how every other kind in
the contract states relationships (graph `edges`, table `relations`), it lets an endpoint be a task as
well as an item without duplicating the field on both, and validation, drawing, the textual
equivalent and inspection each read one array. `type` uses the four standard Gantt names spelled out
(`finish-to-start`…) rather than `FS`/`SS`, which an agent misreads less; the default is
`finish-to-start`, the only one most plans use.

*Alternative:* `predecessors: ["T1"]` on items. Rejected for the reasons above; it also cannot carry
a type without becoming a list of objects anyway.

**Resolution.** Each endpoint resolves to an interval in day units: an activity `[start, end]`, a
milestone `[date, date]`, a task the hull of its items. The type picks one end of each: `finish-to-*`
reads the predecessor's end day, `start-to-*` its start day; `*-to-start` the successor's start day,
`*-to-finish` its end day.

**Satisfaction.** Not satisfied iff the successor's day is strictly before the predecessor's day.
Same day is satisfied, so "review on 1 March, then the next phase starts 1 March" reads as intended.
Day granularity — not the half-day milestone position nor the end-of-day bar edge — is used on
purpose: it is what the dates state, and the drawing's sub-day offsets are presentation.

**Not enforced.** An unsatisfied dependency is drawn (warning colour and dashed) and reported, not
refused: a schedule whose dates break a dependency is the slip the reader needs to see, and refusing
it would force the agent to falsify either the dates or the link to get anything shown. Cycles, by
contrast, can never be honoured by any dates, so they are refused (DFS over declared dependencies;
the message lists one cycle).

**Drawing.** Arrows are computed in the layout (D6) after items are placed: anchor at the chosen end
of the glyph (bar edge, star centre, or the task hull's edge on the task's first lane), routed as an
orthogonal polyline — out horizontally by a small gap, vertically to the successor's row, then
horizontally into the anchor — through the gap between lanes. The SVG draws arrows before glyphs
and annotations, so labels sit on top (spec: *ArrowsDoNotHideLabels*); arrows are excluded from the
annotation collision pass, since avoiding every arrow would make lane assignment depend on
routing and routing on lanes. Selecting an item adds an emphasis class to its arrows.

## Risks / Trade-offs

- [Several `else` arms silently treat unknown kinds as tables] → D9 makes every arm explicit; a test
  per surface presents a timeline and asserts it was not read as a table.
- [Adding scales later (`week`, `quarter`) changes what version 3 accepts] → the same window that let
  viewpoints into version 2 applies: until a release publishes version 3 it may grow in place; after
  that, a new scale means version 4. Stated in the conformance README.
- [Label-width estimation differs from real font metrics] → the estimator is the one graph boxes
  already rely on; labels get padding, and the bench pass checks real rendering for overlaps.
- [Very long ranges produce very wide SVGs (100 years ≈ 146 000 px)] → no ceiling by request; month
  lines are cheap, and browser width limits sit far above realistic programmes.
- [A page left open past midnight shows yesterday's Today] → recomputed on every render/mount; a
  timer is not worth its test surface for this change.
- [Dense dependency graphs produce crossing arrows] → orthogonal routing plus emphasis on selection;
  no crossing minimisation in this change.
- [A task endpoint's span changes when an item is added to the task] → intended: the task *is* its
  items; inspection shows the resolved dates so the reader sees what was compared.
- [The `unknown-version` case moves again] → recorded with `changedAfterFreeze`, as the README already
  anticipates.

## Migration Plan

Additive. No stored data changes; version 1 and 2 documents are untouched. Rollback is reverting the
change; any version 3 document then reads as an unsupported version, which is the existing refusal.
