# Proposal

## Why

A timeline is drawn at one fixed density, about 120 px a month, with a month header. A six-week test
campaign comes out as a sliver with no week to read it by, and a three-year programme is several screens
wide with no way to see it whole. The view also opens on *Today*. When every change of a comparison lies
before *Today*, the comparison opens on a stretch where nothing moved and seems to show no change at all
(seen on the bench).

The contract already names a `scale`, but its only value is `month`. The reader cannot change it, and
neither can a figure.

## What Changes

- **Three scales and a fitted view.** `time.scale` accepts `week`, `month` and `quarter`. It is the scale
  the timeline opens at: a choice of display, like one row per section, never a property of the plan.
  Contract version 3 is in no release yet, so it is extended in place.
  - **Week**: about 12 px a day; months over ISO week numbers.
  - **Month**: today's view; years over months.
  - **Quarter**: about 0.75 px a day; years over quarters.
- **The reader chooses.** The reader offers *week · month · quarter · fit*:
  - *fit* draws the whole range in the visible width and follows the view when it is resized;
  - a chosen scale never leaves the view empty: a plan shorter than the view is stretched to fill
    it, still labelled in the chosen unit;
  - changing scale keeps the date at the middle of the view where it was;
  - the enlarged view shares the display options with the copy in the conversation;
  - the document, the text equivalent, selection and details are unaffected.
- **The header labels the chosen unit, or what the density allows.** At a chosen scale, the header
  labels that scale's unit. In a fitted view or a figure fitted to a width, it labels the finest unit
  it can still read: weeks, months or quarters. Years always stay named.
- **Opening on what matters.** A comparison opens on its first change when that change is outside the
  view. Otherwise the view opens on *Today*, as now. After opening, the scroll position belongs to the
  reader.
- **Figures.**
  - `write_structure_figure` takes `scale` for timelines. A `width` still fits the figure and takes
    precedence over the density `scale` sets.
  - A downloaded or copied figure follows the scale chosen in the reader. *Fit* gives the figure drawn
    at the visible width.
- **Agent guidance.** The skill and the tool descriptions say which scale suits which plan: `week` for a
  few months, `month` for a year or two, `quarter` beyond.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-exchange-timeline`, introduced by `add-structured-exchange-timeline` and not yet archived.
  This change:
  - widens `scale`;
  - lets the header follow the density;
  - adds the reader's scale control and the opening rule;
  - extends figures and the figure writer to scales.

## Impact

- Contract and conformance:
  - `shared/schemas/structured-exchange-3.json`, its skill copy and the generated check;
  - the `StructuredTimelineData` type;
  - the `v3-timeline-unsupported-scale` conformance case and its test, which now refuse `day`;
  - new valid `v3-` cases for `week` and `quarter`.
- Layout and figure:
  - `shared/src/structuredExchangeTimeline.ts`: density per scale, and the header unit chosen from the
    density, as week, quarter or month bands and lines;
  - `shared/src/structuredExchangeTimelineFigure.ts`: the header drawn per unit, and `scale` in the
    figure options.
- Reader: `ui/src/presentations/TimelineView.tsx`:
  - the scale control and fit with a resize observer;
  - keeping the middle date when the scale changes;
  - the opening framing for comparisons;
  - download at the chosen scale.
- Agent: `server/src/structuredExchangeFigureTool.ts` (`scale` parameter); the skill,
  `docs/structured-exchange.md` and `docs/comparison.md`.
- Bench: drive scales, fit, resize and comparison framing on the seeded plans.
- Depends on PR #265 (timeline, colours, figures, comparison, periods).
