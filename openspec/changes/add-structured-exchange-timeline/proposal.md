# Proposal

## Why

An agent asked for a project schedule today has two bad options: a Mermaid `gantt` block, which is
diagram syntax the reader cannot validate and the agent cannot maintain as data, or a table of dates,
which loses the one thing a schedule is for — seeing durations, milestones and *today* against the
same axis. The structured-exchange contract already carries graphs, sequences and tables as validated
data that the interface renders natively; a planning timeline is the missing shape for roadmaps,
system-engineering schedules (SRR/PDR/CDR), validation campaigns and multi-system programmes.

Version 2 of the contract was frozen at v0.25.0, so a new kind of document cannot be added to it: it
opens version 3.

## What Changes

- **New contract version `urn:structured-exchange:3`.** Identical to version 2 except that it adds a
  fourth kind, `timeline`. Every document that is valid under version 2 carries the same meaning when
  it declares version 3 instead; versions 1 and 2 are untouched, and their frozen conformance corpora
  keep their verdicts.
- **The `timeline` kind.** `data` declares an optional `title`, a calendar range
  `time: { start, end, scale: "month" }` with `YYYY-MM-DD` dates, and an ordered `rows[]` of two row
  types: a `task` (`id`, `label`, `items[]`) and a `separator` (optional `label`). A task holds any
  number of `activity` items (`start`, `end`) and `milestone` items (`date`), each with an optional
  `id`, `label` and opaque `kind`. No pixel, colour, shape or "today" ever appears in the data.
- **Optional Gantt dependencies.** `data.dependencies[]` links two endpoints — a task, an activity or
  a milestone, by `id` — with a Gantt type: `finish-to-start` (default), `start-to-start`,
  `finish-to-finish` or `start-to-finish`. A task as an endpoint stands for the span of all its items.
  Dependencies are drawn as arrows between the corresponding ends; one the dates do not honour (the
  successor's end moves before the predecessor's allows) is still drawn, marked as not satisfied, and
  reported to the agent — a plan that slips is information, not an invalid document. Cycles, self
  links and unresolved endpoints are refused.
- **Semantic validation** after the schema: real calendar dates, ordered ranges, items inside the
  declared range, unique identifiers; refusals name the rule and point at the offending value, as for
  the other kinds. A timeline cannot name a target or declare removals (it is not proposable in this
  change) and cannot declare viewpoints.
- **Native rendering in the reader**: a proportional calendar axis with year and month headers, task
  rows with bars and star milestones, labelled annotations placed to avoid common collisions, kind
  colours from the existing per-vocabulary palette with a legend, separators with or without a title,
  a distinct *Today* line taken from the reader's own calendar date at render time (or an
  out-of-range marker), dependency arrows, horizontal scrolling with the task-label column kept in
  view, and item inspection showing task, type, dates, label, kind and dependencies.
- **Same surfaces as the other kinds**: `present_structure` accepts timelines, a ```` ```structured-exchange ````
  block in a reply draws one, the textual equivalent and the raw JSON stay available, the conformance
  suite gains `v3-` cases, and the structured-exchange skill ships the version 3 schema with a
  timeline example. `write_structure_figure` and `write_structure_table` refuse a timeline with a
  reason, the way the figure writer refuses a table today.

## Capabilities

### New Capabilities

- `structured-exchange-timeline`: the version 3 contract and its `timeline` kind — shape, semantic
  rules, dependencies, rendering, the current-date indicator, navigation, inspection, and how the existing tools
  treat a timeline.

### Modified Capabilities

- `structured-exchange`: `OnlySomeKindsMayBeProposed` enumerates the supported kinds as exactly
  graph, sequence and table; it is scoped to versions 1 and 2 and points at version 3 for the
  timeline, which is not proposable.

## Impact

- **Contract**: new `shared/schemas/structured-exchange-3.json`, its generated browser check, the
  Node validator's schema table, supported-identifier list, ceilings and types in
  `shared/src/structuredExchange.ts`; semantic rules in `shared/src/structuredExchangeValidation.ts`;
  the skill's bundled copy under `skills/structured-exchange/`.
- **Conformance**: `shared/conformance/` gains `v3-` cases; the `unknown-version` case, which uses
  the version 3 identifier today, moves to version 4 and is recorded in the lock with a
  `changedAfterFreeze` reason.
- **Rendering**: a pure timeline layout in `shared/` and a `TimelineView` in
  `ui/src/presentations/StructuredExchangeView.tsx`; the textual equivalent in
  `shared/src/structuredExchangeModel.ts`.
- **Tools**: `server/src/structuredExchangeTool.ts` (description, digest), the figure and table
  writers' refusals, profile check treating a timeline as unconstrained.
- **No new dependency**, no protocol change: timelines travel in the same tool results and reply
  blocks as the other kinds.
