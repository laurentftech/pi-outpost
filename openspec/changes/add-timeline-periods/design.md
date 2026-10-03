# Design

## Context

Version 3 is unreleased and has grown in place before (comparisons). The timeline's layout
(`layoutTimeline`) and figure (`timelineFigureParts` / `timelineFigure`) are shared by the reader and the
writer; the header has a top band (`TIMELINE_TODAY_BAND`) that holds only the *Today* tag. Kind colours come
from `assignTints` with optional project colours.

## Goals / Non-Goals

**Goals:** periods and reference dates as data, drawn identically on screen and in files.

**Non-Goals:** recurring periods (every weekend, every August); working-day calendars or durations counted
in working days; warnings for work inside a closure; a project-wide calendar in the registry (possible
later, merged at drawing time); comparing periods between plans.

## Decisions

### D1. Two lists on `data`, not row types

`periods` and `references` are siblings of `rows` and `dependencies`. They are not rows (they span all
rows) and not items (they belong to no task), so neither existing collection fits. Ceilings: 100 periods,
50 references.

### D2. Edges

A period may overlap the range's edge and is clipped, because a closure straddling the plan's first week
is ordinary and refusing it would force the agent to widen the plan for a decoration. A period wholly
outside draws nothing, so it is refused like any other value that cannot be shown. A reference is a single
day and must be inside the range, like a milestone.

### D3. Colour

Period and reference kinds share the items' vocabulary (and the project's `appearance.kinds`), so
`fermeture` is one colour wherever it appears. Bands use the tint's stroke at low opacity (≈ 0.12); an
unkinded period uses a neutral grey with a diagonal hatch (a `pattern` would need a new primitive, so the
hatch is drawn as clipped diagonal lines in the band's group). References are drawn dashed (`6 3`), 1.5 px,
in the kind's colour or a neutral dark grey; *Today* stays solid orange, 2 px.

### D4. Names

Period and reference labels go in the top header band, shared with the *Today* tag, placed left to right
with the same greedy collision rule as annotations (one lane; a label that does not fit its band or
collides is left out of the header). Every period and reference is always named in the legend
("Fermeture 21 Dec 2026 – 3 Jan 2027") and on hover (group title), so a hidden header label loses nothing.

### D5. Drawing order

Grounds and month lines, separators, then translucent period bands (so they read across separators
too), reference lines, arrows, items, *Today*. Each band is also carried up into the header's year and
month bands, so where it falls reads against the calendar. (Implemented this way rather than bands under
separators, which would have needed every separator redrawn translucent.)

### D6. Elsewhere

`compareTimelines` copies the current plan's `periods` and `references`. The text equivalent lists them
after the rows; the digest counts them.

## Risks / Trade-offs

- [Many periods crowd the header] → labels are dropped from the header first; legend and hover keep them.
- [Hatch lines add primitives on long plans] → hatching only unkinded periods, spaced 6 px.
- [Version 3 grows again] → still before any release; stated in the conformance README.
