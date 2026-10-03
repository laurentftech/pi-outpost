# Proposal

## Why

A planning timeline can be presented in the conversation but cannot leave it. `write_structure_figure`
refuses a timeline and the reader offers no "download SVG" for one, so a schedule cannot be put into the
Word or Markdown report it usually belongs in — the graph and the sequence can. The next change (comparing
two plans) needs the same thing for the compared version, so the figure comes first.

## What Changes

- **A timeline figure**, produced without a browser from the same layout the reader draws: one
  self-contained SVG with the task-label column, the year/month header, rows, bars, stars, annotations,
  dependency arrows and the legend. The reader's own timeline is drawn from the same figure parts, so the
  picture on screen and the picture in a file cannot drift apart.
- **`write_structure_figure` draws timelines** instead of refusing them, with options for the display
  choices the reader already has — one row per section, dependencies hidden — and a target `width` that
  scales the axis so a long plan fits a page.
- **A dated reference line in written figures.** A file outlives the day it was drawn, so a written or
  downloaded figure labels the current-date line with its date ("3 Oct 2026") rather than "Today", and the
  writer can omit it.
- **The reader can download or copy a timeline's SVG**, as it can a graph's, reflecting the display options
  currently chosen.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-exchange-timeline` (introduced by `add-structured-exchange-timeline`, not yet archived): adds
  the figure requirements, and changes `ATimelineTravelsLikeEveryOtherKind` so that `write_structure_figure`
  draws a timeline instead of refusing it (`write_structure_table` still refuses).

## Impact

- `shared/src/structuredExchangeTimeline.ts` (layout takes a pixels-per-day scale) and a timeline figure
  function beside the graph and sequence ones in `shared/src/structuredExchangeFigure.ts` (or its own module).
- `shared/src/structuredExchangeExport.ts` (`figureForEnvelope` accepts a timeline), and
  `server/src/structuredExchangeFigureTool.ts` (parameters, description).
- `ui/src/presentations/TimelineView.tsx` renders from the figure parts; `StructuredExchangeView.tsx` offers
  download/copy for a timeline.
- Skill and producer docs: a timeline figure in a report.
- Depends on `add-structured-exchange-timeline` and `add-project-kind-colours` (figures use project colours).
