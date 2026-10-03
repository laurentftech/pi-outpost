# Design

## Context

Layout (`layoutTimeline`) is a pure function of the document, today and options. It already takes
`pxPerDay`, and figures fitted to a width use it (`timelineFigureParts`, `TIMELINE_MIN_PX_PER_DAY` = 0.25).

The header has three bands:

- *Today*, 18 px;
- year, 20 px;
- month, 20 px.

Lines are drawn at month boundaries (`monthLines`). The year repeats at each quarter. Month labels are
already shortened by width (`monthLabelFor`).

The reader draws at `TIMELINE_PX_PER_DAY` = 4. On mount, it scrolls Today to a third of the view when
Today is past 80 % of the view's width. `time.scale` is required, with `month` as its only value.

## Goals / Non-Goals

**Goals:**

- three scales and a fitted view, in the reader and in figures;
- a header that stays legible at any density;
- a comparison that opens on its changes.

**Non-Goals:**

- day scale and hour precision;
- zooming with the pinch gesture or the mouse wheel;
- remembering the chosen scale across reloads;
- fiscal quarters or weeks not starting on Monday;
- localising the header (it stays in the reader's existing English: `Jan`, `W41`, `Q1`).

## Decisions

### D1. Scale is a display choice

`time.scale` becomes `week | month | quarter` and stays required. Making it optional would change the
contract's shape for no gain, and every v3 document already carries it. Version 3 is unreleased and is
extended in place, as before.

The text equivalent keeps writing "by <scale>". The digest is unchanged apart from that word.
`compareTimelines` keeps the current plan's `time`, so it keeps its scale.

### D2. Densities

| Scale | px/day | Unit width |
| --- | --- | --- |
| week | 12 | week ≈ 84 px |
| month | 4 | month ≈ 120 px, as today |
| quarter | 0.75 | quarter ≈ 68 px, year ≈ 274 px |

A 3-month campaign is ≈ 1100 px at `week`. A three-year programme is ≈ 820 px at `quarter`.

They are exported as `TIMELINE_SCALE_PX_PER_DAY`. `TIMELINE_PX_PER_DAY` stays the month value for
existing callers.

### D3. Header unit from density, not from the declared scale

`layoutTimeline` derives the header unit from `pxPerDay` alone:

- weeks at 8 px/day or more (a week ≥ 56 px, room for `W41`);
- months from 1 px/day (a month ≥ 28 px, room for `Jan`);
- quarters below that.

One rule then serves declared scales, fit and fitted figures. A week-scale plan fitted into 900 px cannot
show 150 unreadable week columns.

The layout returns:

- `unit`: `week`, `month` or `quarter`;
- upper bands (`years`; for weeks, months labelled `Mar 2027`);
- lower bands (`weeks`, `months` or `quarters`);
- `unitLines`, the boundary lines.

`years`, `months` and `monthLines` stay as the calendar's facts (tests and the year repeat read them); the figure draws from `upper`, `lower` and `unitLines`. Under the week unit, the lower band's labels are `W<n>`, and the upper band's are `Mar 2027`. Weeks follow ISO 8601:
they start on Monday, and week 1 holds the year's first Thursday. A week cut by the range edge is drawn
clipped and labelled only when wide enough.

The year repeat at each quarter stays for the month unit. With quarters, every quarter band carries its
label (`Q1`), and the year band above names the year. Period bands (`add-timeline-periods`) are carried
into whichever upper and lower bands exist.

### D4. Fit

The reader measures the scroller with a `ResizeObserver` and computes the density:

`pxPerDay = clientWidth / span`, clamped below by `TIMELINE_MIN_PX_PER_DAY`.

Below the clamp, the timeline scrolls. Each resize recomputes the density, after one animation frame to
avoid observer loops. Fit has no scroll position to keep.

### D4b. A chosen scale fills the view

A chosen scale is a least density: `pxPerDay = max(scale density, clientWidth / span)`. A plan shorter
than the view at that scale is stretched to the view's width rather than leaving it empty. The layout
takes an optional `unit` that the density never makes finer (`timelineHeaderUnit(px, atLeast)`), so a
quarter view stretched to 1.6 px/day still labels quarters. Fit passes no unit: its unit follows the
density. A figure given `scale` and `width` passes the scale as that minimum. A figure given `scale`
alone draws at the scale's own density: a file has no view to fill.

### D5. Keeping the middle date

Before a scale change, the reader converts the scroller's middle `x` to a fractional day. After the new
layout, it sets `scrollLeft` so that day is at the middle again, clamped to the scroll range. This is the
only programmatic scroll after mount.

### D6. Opening framing

The rule runs on mount only, and a pure helper chooses the opening `x`:

- **A comparison in comparison mode**: the target is the smallest `x` of any change — a moved item's
  current or previous position, an added item, or a removed item. If that `x` is outside
  `[0, clientWidth)`, scroll so it sits at a sixth of the view, leaving a little lead-in.
- **Otherwise**: today's rule, unchanged.

Switching between the comparison and the new version only does not re-run the rule.

### D7. Figures and the tool

`TimelineFigureOptions` gains `scale`. The density is:

- `width` if given (fit);
- else `scale`'s density;
- else the declared scale's.

`write_structure_figure` gains `scale` (`week | month | quarter`), and its description says that `width`
wins. The reader's download passes the chosen scale. Under fit, it passes `width` = the scroller width
plus the label column, so the file matches the screen.

### D8. Control

The control is a link-style group like the existing toggles: `week · month · quarter · fit`. The current
choice is marked with `aria-pressed`, and its test id is `timeline-scale`. It is placed first in the
toolbar, because it changes the most.

### D9. Display options shared with the enlarged view

The enlarged view mounts a second `TimelineView`. The display options (scale, compact, dependencies,
comparison, only what moved) move into one `TimelineDisplay` value held by `StructuredExchangeDocument`,
as the graph's orientation already is. Both copies read and update it. Selection and scroll stay per
copy: they are interaction state, not a way of drawing.

## Risks / Trade-offs

- **Week scale on a long plan is very wide** (a 3-year plan is ≈ 13 000 px). The reader allows it,
  because it is the reader's choice. The skill tells agents which scale suits which plan length.
- **A ResizeObserver loop in fit.** Measure only the scroller, which does not change size with its
  content, and defer the update to the next frame.
- **Existing fitted figures could change header unit.** An 18-month plan at 900 px is ≈ 1.3 px/day, so it
  keeps months; below 1 px/day it now shows quarters, which is clearer than initials. The figure tests
  assert years and proportions, not month labels at that density, so they are rechecked rather than
  relaxed.
- **The schema enum changes.** The `v3-timeline-unsupported-scale` case and its test move from `week` to
  `day`.
