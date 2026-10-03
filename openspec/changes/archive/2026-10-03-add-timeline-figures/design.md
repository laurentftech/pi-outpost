# Design

## Context

- The timeline's geometry is already a pure function, `layoutTimeline(data, today, { compact })` in
  `shared/src/structuredExchangeTimeline.ts`, at a fixed `TIMELINE_PX_PER_DAY`. `TimelineView` paints it as
  an HTML label column plus two SVGs (header, rows) inside one horizontal scroller.
- Graphs and sequences draw through a shared figure model (`Figure` → groups of `Primitive`s: rect, text,
  line, path, with markers) in `shared/src/structuredExchangeFigure.ts`; `serializeFigure` writes the SVG
  for files, and the reader's `Drawn` component renders the same groups. `figureForEnvelope`
  (`shared/src/structuredExchangeExport.ts`) refuses everything but graph and sequence.
- Project colours (`add-project-kind-colours`) already reach both paths through an optional `appearance`.

## Goals / Non-Goals

**Goals:** one figure function for timelines, used by the writer, the reader's download and the reader's
own drawing; fit-to-width for documents; a dated reference line in files.

**Non-Goals:** PNG/PDF output; pagination of very long plans across pages; a window (sub-range) option;
the comparison drawing (next change, built on this one).

## Decisions

### D1. `timelineFigure` produces named parts, not only a whole SVG

`timelineFigure(data, { today?, compact?, showDependencies?, pxPerDay?, width?, appearance?,
referenceLine?: "today" | "dated" | "none" })` returns a `Figure` for files, built from parts it also
exports: `labels` (task-label column), `header`, `rows` (separators, bars, stars, annotations, arrows,
reference line) and `legend`, each a list of `FigureGroup`s with their own extent. The reader keeps its
layout — label column outside the horizontal scroller — but draws each region from those parts through
the existing `Drawn` renderer, adding only interaction (selection, focus ring, emphasis) on top. The file
concatenates the same parts: labels at x = 0, header and rows offset by the label width, legend below.

*Alternative:* render the file from the React view with a DOM serializer. Rejected: the writer runs in the
agent's process with no DOM, which is the reason graph figures moved to `shared/` in the first place.

### D2. Scale is a layout input

`layoutTimeline` takes `pxPerDay` (default `TIMELINE_PX_PER_DAY`). With a target `width`, the figure
computes `pxPerDay = (width - labelWidth - margins) / days`, with a floor (0.25 px/day) below which the
figure is wider than asked and the writer says so. Lane assignment already works from text widths and
positions, so narrowing only adds lanes. Month labels: full (`Jan`) when the band is ≥ 24 px, one letter
when ≥ 9 px, none below; years always, repeated each quarter as on screen.

### D3. Reference line by context

The reader passes `"today"` (labelled `Today`). Downloads and the writer default to `"dated"`: the line is
labelled with the day it was drawn, e.g. `3 Oct 2026`, in English month abbreviations like the header.
The writer exposes `reference_line: "dated" | "none"`. The date is the process's local calendar date,
taken once per figure.

### D4. Writer parameters

`write_structure_figure` gains, for timelines only: `compact` (boolean), `hide_dependencies` (boolean),
`width` (number, 300–4000), `reference_line` (`"dated"` default, or `"none"`). The graph-only parameters
(`hide_element_kinds`, `hide_relationship_kinds`, `viewpoint`) are refused for a timeline with a reason,
rather than silently ignored. The description says a timeline is drawn and how to size it for a page.

### D5. Downloads strip interaction

The reader's "download SVG" / "copy markup" for a timeline call `timelineFigure` with the current display
options and `referenceLine: "dated"`, rather than serializing the live DOM — so selection emphasis, focus
rings and the details strip cannot leak, and the file matches what the writer would produce.

### D6. Archive order

This change modifies `ATimelineTravelsLikeEveryOtherKind`, a requirement of a capability introduced by
`add-structured-exchange-timeline`. It must be archived after that change (validation reports the order
requirement as INFO).

## Risks / Trade-offs

- [Re-rendering the reader from figure parts could regress interaction] → the existing view tests and the
  bench monkey pass are re-run; selection and focus stay in the React layer.
- [Very long plans at a page width become dense] → lanes grow and labels stay legible; below the scale
  floor the figure is wider than asked and the tool says so. A sub-range option is a later change.
- [A dated line in a file the reader later opens looks stale] → that is the point: it states the date of
  the picture.

## Implementation notes

- The reader keeps its HTML task-label column and legend (accessible buttons, already correct);
  its header and rows are drawn from the figure parts through `Drawn`. The file assembles the
  same header and rows with SVG labels and key. Download/copy live in the timeline's own control
  bar, so they always serialize the options shown — including in the enlarged view.
- Rect primitives gained `fillOpacity` (screen and serializer) for kinded bars.
