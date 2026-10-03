# Timelines: a schedule as data

Part of the `structured-exchange` skill. The envelope, validation and size limits are in its `SKILL.md`.

A project schedule, a roadmap, a validation campaign: declare it as a version 3
`timeline` rather than as a Mermaid `gantt` block or a table of dates. The interface
draws a proportional calendar, bars, star milestones, dependency arrows and a **Today**
line taken from the reader's own date.

```json
{
  "schema": "urn:structured-exchange:3",
  "kind": "timeline",
  "data": {
    "title": "Programme X",
    "time": { "start": "2026-10-01", "end": "2027-12-31", "scale": "month" },
    "rows": [
      { "type": "separator", "label": "System A" },
      { "type": "task", "id": "T1", "label": "System studies", "items": [
        { "type": "activity", "id": "study", "start": "2026-11-01", "end": "2027-02-28", "label": "Preliminary study" },
        { "type": "milestone", "id": "srr", "date": "2027-03-01", "kind": "SRR", "label": "System Requirements Review" },
        { "type": "activity", "id": "design", "start": "2027-03-15", "end": "2027-07-31", "label": "Detailed design" },
        { "type": "milestone", "id": "cdr", "date": "2027-08-01", "kind": "CDR" }
      ] },
      { "type": "separator" },
      { "type": "task", "id": "T2", "label": "Development", "items": [
        { "type": "activity", "id": "dev", "start": "2027-03-01", "end": "2027-09-30" }
      ] }
    ],
    "dependencies": [
      { "from": "study", "to": "srr" },
      { "from": "srr", "to": "T2" },
      { "from": "design", "to": "cdr", "type": "finish-to-finish" }
    ]
  }
}
```

- **Rows** are drawn in order. A `task` has an `id`, a `label` and any number of
  `items` — activities and milestones, overlapping or with gaps, in any order. A
  `separator` divides groups of tasks, with a `label` or without one.
- **An activity** runs from `start` to `end` inclusive; **a milestone** is a `date`.
  Dates are calendar days, `YYYY-MM-DD`, and every item must fall inside `time`:
  one outside is refused, never clipped — widen `time` instead.
- **`label`** is what a reader sees beside the item; a milestone without one shows its
  `kind`. **`kind`** is your own vocabulary (`SRR`, `PDR`, `CDR`); every kind gets its
  own colour and a legend entry. Write no colour, position, shape or "today" — the
  renderer derives them, and the schema refuses them.
- **A dependency** says `to` waits on `from`. Each names a task or an item by `id` (give
  an item an `id` if anything depends on it); a task stands for the span of its items.
  `type` is `finish-to-start` when omitted, or `start-to-start`, `finish-to-finish`,
  `start-to-finish`. A dependency the dates break is **drawn and reported to you as
  not satisfied**, not refused — tell the user, do not move dates to hide it. A cycle
  is refused.
- A timeline is not a proposal: it has no `target`. To change one, present the whole
  revised timeline again. `write_structure_table` refuses it.
- **Choose `time.scale` for the plan's length**: `week` for a few months (a test campaign),
  `month` for a year or two, `quarter` beyond (a multi-year programme). It is only the scale
  the plan opens at — the reader can switch to another or fit it to the screen — and it moves
  no date.
- **Closures, holidays and key dates** belong in the plan: `periods` (`start`, `end`, optional
  `label` and `kind`, e.g. `"fermeture"`) are drawn as bands across every row, and `references`
  (`date`, `label`, optional `kind`, e.g. a contractual date) as named lines. They constrain
  nothing. A period may run past the plan's range (drawn clipped); a reference must fall inside it.
- **To show what changed between two versions of a plan**, keep each version as its own
  timeline file and call `compare_timelines` with the previous and the current one — never
  work out the shifts yourself. It pairs tasks and items by `id`, so give every item an `id`
  in a plan that will be compared; it tells you how many it could not pair. The reader sees
  previous dates dashed, shifts like `(+3w)`, new and dropped items marked, and can switch to
  the new version alone. Give `output_path` to keep the comparison for a report, and draw it
  with `write_structure_figure` (`comparison: "new"` draws the new version alone). A compared
  timeline carries `comparedTo`, `previous` dates and `role: "added" | "removed"`; do not write
  these by hand.
- **To put a timeline in a report**, write it with `write_structure_figure` and reference
  the `.svg` from the Markdown. Give `width` (e.g. `900`) for a page — durations stay
  proportional and rows grow to keep labels apart, and the header switches to months or
  quarters when weeks would not fit; `scale` (`week`, `month`, `quarter`) to draw it at that
  scale's natural size instead; `compact: true` for one row per section;
  `hide_dependencies: true` to leave the arrows out. The figure's date line is labelled
  with the day it is written (`reference_line: "none"` leaves it out), because the file
  outlives that day. Graph options (`hide_element_kinds`, `viewpoint`…) are refused for a
  timeline.
