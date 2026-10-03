# Proposal

## Why

A schedule is presented over and over as it changes, and what people need to see at each review is what
moved since last time: which phases slipped, by how much, what was added and what was dropped. Today the
only way is to put two timelines side by side and compare them by eye.

Both forms are needed: the new plan on its own, to keep and archive, and the plan compared with the
previous one, to put in a review report or show in a meeting.

## What Changes

- **A timeline may state what it is compared with** (contract version 3, extended in place — it is not yet
  in any release): `comparedTo` names the previous plan; an activity or milestone may carry `previous`
  dates; a task or item may carry `role: "added"` or `"removed"`. A timeline without `comparedTo` is a
  plain plan, exactly as today.
- **`compare_timelines`**, an agent tool that reads two timeline files, pairs tasks and items by `id`, and
  produces the comparison timeline — so no slip is computed by hand. Items without an `id` cannot be paired;
  the tool says how many and leaves them uncompared. The result is presented, and optionally written to a
  file. Both input files are left as they are: the new plan stays pure.
- **The reader draws the comparison**: the previous position dashed and the current one solid, with the
  shift written beside the annotation ("+3 wk"); added items marked new; removed items dashed and struck.
  The reference plan is named above the timeline, and the legend explains the marks.
- **Two views of one document**: "comparison" (initial) and "new version only", which draws the plan as if
  it carried no comparison; and an "only what moved" filter for meetings.
- **The comparison leaves as a figure**: `write_structure_figure` and the reader's download draw either
  view, so it can go into a report.
- The text equivalent and the agent's digest list every shift, addition and removal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-exchange-timeline` (introduced by `add-structured-exchange-timeline`, figures by
  `add-timeline-figures`, neither archived yet): adds the comparison fields and rules, drawing, views,
  the comparison tool and comparison figures.

## Impact

- `shared/schemas/structured-exchange-3.json`, its copy in the skill, the generated browser check, the
  types and ceilings in `shared/src/structuredExchange.ts`; rules in
  `shared/src/structuredExchangeTimelineValidation.ts`; `v3-` conformance cases (the version 2 lock is
  unaffected; version 3 has no lock yet).
- Layout and figure: `shared/src/structuredExchangeTimeline.ts` and the timeline figure from
  `add-timeline-figures`; the comparison itself in a new pure module.
- `server/src/timelineComparisonTool.ts` (new), registered wherever `write_structure_figure` is
  (`server/src/piOutpostTools.ts`, `server/src/index.ts`, `server/src/sandbox.ts`).
- `ui/src/presentations/TimelineView.tsx`; text equivalent; `present_structure` digest.
- Skill and docs.
- Depends on `add-timeline-figures`.
