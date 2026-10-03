# Proposal

## Why

A schedule is read against the calendar it runs in: a year-end closure, summer holidays, a plant
shutdown explain a gap or a slip at a glance, and a contractual date or a delivery date is what the plan
is judged against. Today a timeline can show none of them except the reader's *Today* line, so they are
written in a label, in the conversation, or nowhere.

Both belong in the plan itself: they are part of what the schedule means, they must travel with it into
a report or a meeting, and the agent has to see them when it builds or shifts tasks.

## What Changes

- **Periods** (contract version 3, extended in place — it is in no release yet): a timeline may declare
  `periods`, each with `start`, `end`, an optional `label` and an optional opaque `kind`
  (`"fermeture"`, `"vacances"`…). The reader draws each as a pale band across every row, under bars and
  arrows, named in the header and in the legend; its colour follows its kind (project colours included),
  neutral hatched grey without one. A period constrains nothing.
- **Reference dates**: a timeline may declare `references`, each a `date`, a `label` and an optional
  `kind` (contract date, delivery…). The reader draws each as a named vertical line across every row,
  distinct from the *Today* line.
- **Rules**: real days, ordered periods, references inside the range; a period may run past the range's
  edges (drawn clipped) but not lie wholly outside it.
- **Everywhere a timeline goes**: figures, downloads, the text equivalent and the agent's digest list
  them; a comparison carries the current plan's periods and references, uncompared.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-exchange-timeline` (introduced by `add-structured-exchange-timeline`; not yet archived):
  adds periods and reference dates.

## Impact

- `shared/schemas/structured-exchange-3.json` (+ skill copy, generated check), types and ceilings in
  `shared/src/structuredExchange.ts`, rules in `shared/src/structuredExchangeTimelineValidation.ts`,
  `v3-` conformance cases.
- Layout and figure: `shared/src/structuredExchangeTimeline.ts`, `shared/src/structuredExchangeTimelineFigure.ts`;
  text and digest; `compareTimelines` carries them.
- Reader: `ui/src/presentations/TimelineView.tsx` (legend, hover names).
- Skill and producer docs.
- Depends on PR #265 (timeline, colours, figures, comparison).
