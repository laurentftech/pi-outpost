# Design

## Context

- Contract version 3 exists only on the unreleased branch, so it may still grow in place (as version 2 did
  for viewpoints before v0.25.0). Version 3 has no conformance lock yet.
- The table already reports change roles (`added`, `changed`, `context`, `removed`) without becoming a
  proposal; a compared timeline does the same for items, with `previous` dates standing for `changed`.
- `add-timeline-figures` gives one figure function used by the reader and the writer; the comparison is
  drawn there once.
- Agent tools are registered in three places (`server/src/piOutpostTools.ts`, `server/src/index.ts`,
  `server/src/sandbox.ts`); `write_structure_figure` shows the pattern for a tool that reads workspace
  files and writes into the writable zone (`assertWritableDestination`).

## Goals / Non-Goals

**Goals:** a compared plan as data; a tool that computes it; both views from one document; the comparison
as a figure.

**Non-Goals:** more than one reference plan; comparing dependencies, labels or kinds (a renamed item is
unchanged unless its dates moved); a reader-side "compare with file…"; merging plans.

## Decisions

### D1. Comparison is data on the new plan, produced by a tool

`comparedTo`, `previous` and `role` live in the compared document so it can be shared, exported and
reopened unchanged — a review report must not depend on two files still existing. The pure plan never
carries them: `compare_timelines` produces a separate document. `role` reuses the table's vocabulary
(`added`, `removed`); `changed` is not a role here because `previous` states it with its dates.

### D2. Pairing by `id`, never by label

Tasks are paired by task `id`, items by item `id` across the whole plan (an item moved to another task is
paired and shown on its new task). Items without `id` are not paired: guessing by label or by order would
present a guess as a fact in a review. The tool reports the counts so the agent can tell the user to give
items identifiers.

### D3. Drawing

- Previous activity: dashed outline (no fill), same lane, drawn under the current bar; it is an occupant
  in lane assignment (`ghost`, compatible with bars and stars of the same item, not with labels), so
  annotations still avoid it.
- Previous milestone: hollow dashed star; a thin dashed connector to the current star when on the same
  lane.
- Shift text appended to the annotation in brackets, set in italics (a `tspan`) so it is not read as
  part of the name: `(+3w)` when both ends moved equally, `(+1w, end+4w)` when they differ, `(end+4w)` or
  `(start+1w)` when one end moved. Units: days < 14 (`d`), weeks < 10 (`w`), months otherwise (`mo`,
  30.44 d), rounded.
- Added: `(new)` after the annotation, in italics too; removed: dashed bar or hollow star, struck annotation.
- Colour stays the kind's colour throughout; meaning is carried by dash and fill, which also survive
  print.

### D4. Views are layout options

`layoutTimeline` / `timelineFigure` gain `comparison: "compare" | "new"` and `onlyChanged: boolean`.
`"new"` drops removed items, previous data and badges — equivalent to stripping the comparison from the
document, which a test asserts. Both toggles live in React state beside compact and dependencies.

### D5. The tool

`compare_timelines({ previous_path, current_path, label?, output_path? })`: reads both through the same
confinement and size limits as `write_structure_figure`, validates both, computes the comparison in a pure
shared function (`compareTimelines(previous, current, label)`), validates the result, presents it like
`present_structure` (same digest), and writes it when `output_path` is given. Removed items go back under
their task by task `id`; a removed task keeps its position relative to the previous plan's order (inserted
after the preceding task that still exists).

### D6. Archive order

Archive after `add-structured-exchange-timeline` and `add-timeline-figures`.

## Risks / Trade-offs

- [Items without ids make comparisons incomplete] → said in the tool result and the skill tells the agent
  to give every item an `id` when a plan will be compared.
- [Dense slips crowd rows] → ghosts take part in lane assignment; "only what moved" for meetings.
- [Version 3 grows after a release] → this must land before the release that first publishes version 3;
  otherwise it is version 4. Stated in the conformance README.
