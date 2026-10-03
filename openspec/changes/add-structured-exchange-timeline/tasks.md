# Tasks

## 1. Version 3 contract

- [x] 1.1 Add `shared/schemas/structured-exchange-3.json`: version 2 with `$id` `urn:structured-exchange:3`, `kind` enum gaining `timeline`, and a `timeline` `data` branch (`title?`, `time {start,end,scale:"month"}` with a `YYYY-MM-DD` pattern, `rows[]` of `task {type,id,label,items[]}` / `separator {type,label?}`, items `activity {type,start,end,id?,label?,kind?}` / `milestone {type,date,id?,label?,kind?}`, optional `dependencies[]` of `{from,to,type?}` with the four Gantt types, `additionalProperties: false` throughout, ceilings from design D3); verify a hand-written valid timeline passes and a timeline under the version 1 and 2 identifiers is refused, in a new `server/test/structuredExchangeTimeline.test.ts`
- [x] 1.2 Add `STRUCTURED_EXCHANGE_SCHEMA_V3`, the version to `STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS`, `StructuredExchangeKind` `timeline`, the timeline data types and `STRUCTURED_EXCHANGE_CEILINGS_3` in `shared/src/structuredExchange.ts`; extend the existing schema/constant drift test to the version 3 ceilings and verify it fails when one side is changed
- [x] 1.3 Register version 3 in `structuredExchangeSchemaNode.ts` (schema table, `schemaFor` marker `time`, `NARROWABLE_KINDS`) and regenerate the browser check with `node --import tsx/esm shared/scripts/generate-structured-exchange-check.mjs`; verify a timeline refusal's diagnostic names the timeline branch only, never graph/table properties
- [x] 1.4 Audit every `=== STRUCTURED_EXCHANGE_SCHEMA_V2` / version-2 test in `shared/` and `server/` and make it "enriched version (2 or 3)" where the meaning is "version 2 constructs"; `proposableKinds` returns graph/sequence/table for 2 and 3; verify with a test re-declaring the version 2 conformance cases as version 3 (spec: *AVersionTwoDocumentMeansTheSameUnderVersionThree*)
- [x] 1.5 Move the `unknown-version` conformance case to `urn:structured-exchange:4`, record it in `version-1.lock.json` with a `changedAfterFreeze` reason, add a "version 3" section to `shared/conformance/README.md` (including that new scales mean version 4 once v3 is released); verify `structuredExchangeFrozenVersions.test.ts` passes on both locks

## 2. Semantic rules

- [x] 2.1 In `shared/src/structuredExchangeValidation.ts`, add the timeline rules `invalid-date`, `inverted-range` (time and activity), `item-outside-range` (message states the range) and `duplicate-identifier` across tasks and items, each with a JSON Pointer; verify one test per rule asserting rule name and pointer, plus *ASingleDayActivityIsValid*
- [x] 2.2 Add dependency rules `unresolved-endpoint`, `empty-task-endpoint`, `self-dependency`, `duplicate-dependency` and `dependency-cycle` (message lists the cycle), and the default `finish-to-start`; verify one test per rule asserting rule name and pointer, plus *ATimelineWithoutDependenciesIsValid*, *ADependencyLinksAMilestoneToATask* and *AllFourGanttTypesAreAccepted*
- [x] 2.3 Refuse a timeline carrying `target`/`removals` with `kind-not-proposable` and `viewpoints` with `viewpoints-without-graph`; verify both refusals by test
- [x] 2.4 Add `v3-` conformance cases (valid: full programme example, empty task, anonymous separator, single-day activity, the four dependency types, an unsatisfied dependency; invalid: one per rule above plus unsupported scale, unknown dependency type and an unknown `color` property) to `shared/conformance/` and `index.json`; verify the conformance runner passes and the standalone check reaches the application's verdicts

## 3. Layout

- [x] 3.1 Create `shared/src/structuredExchangeTimeline.ts` with UTC day-number parsing, the month scale (fixed px/day), year and month header bands, and the today position or `before`/`after` marker from an injected `today`; verify by unit tests for *EqualDurationsHaveEqualWidths*, *MonthsAreNotEqualColumns*, *YearsAndMonthsAreLabelled*, the three Today scenarios, and *TimeZoneDoesNotMovePositions* (run under two `TZ` values)
- [x] 3.2 Add row layout and annotation placement (label inside the bar when it fits, otherwise to the right; greedy lane assignment; milestone falls back to `kind`; no text for unlabelled items) using the `structuredExchangeText` estimator; verify by unit tests asserting no label box intersects another label or glyph box for *CrowdedAnnotationsDoNotOverlap*, plus row order and separator-does-not-move-axis
- [x] 3.3 Add kind colour assignment via `structuredExchangePalette` across activities and milestones, with legend order by first appearance; verify same-kind-same-colour and distinct kinds distinct by test

- [x] 3.4 Add dependency resolution (task hull, end chosen by type), the day-granularity satisfaction rule, and orthogonal arrow routing from the placed glyphs; verify by unit tests for *AFinishToStartArrow*, *AStartToStartArrow*, *AnUnsatisfiedDependencyIsShownNotRefused* and *SameDayCountsAsSatisfied* (anchor coordinates and the satisfied flag)

## 4. Reader view

- [x] 4.1 Add `TimelineView` to `ui/src/presentations/StructuredExchangeView.tsx`: fixed task-label column, horizontally scrolling SVG with sticky header, month lines, separators with optional title, dependency arrows drawn beneath glyphs and annotations (unsatisfied ones marked), bars, stars, annotations, legend, today line or edge marker; verify in `StructuredExchangeView.test.tsx` that bars/stars/labels/separators/arrows/today render from a fixed `today`, and that arrows precede annotations in document order (*ArrowsDoNotHideLabels*)
- [x] 4.2 Add item and task-label selection (click, Enter, Escape) with a details strip listing predecessors/successors and their satisfaction, emphasis of the selected item's arrows, and per-item `aria-label`; verify by tests for *SelectingAMilestoneShowsItsDetails*, *SelectingAnItemShowsItsDependencies* and *ItemsAreReachableFromTheKeyboard*, and that the today line is not focusable
- [x] 4.3 Make every kind dispatch explicit (design D9) in the view, `describeStructure`/textual equivalent, `toMermaid` (undefined), `structuredExchangeDocumentItems.ts`, and hide diagram/table export controls for a timeline; verify the textual-equivalent test (*TheTextualEquivalentListsEveryItem*) and that the raw JSON toggle shows the document

- [x] 4.4 Add a reader control that hides and shows dependency arrows when the timeline declares any, saying while hidden that they are; verify by view tests for *HidingDependenciesRemovesOnlyTheArrows*, *ShowingThemAgainRestoresTheArrows* and *NoControlWithoutDependencies*

- [x] 4.5 Add a reader control that draws each section (separator and its tasks) as one row, tasks before the first separator keeping theirs, an unlabelled activity taking its task's name there; verify by layout and view tests for the six *TheReaderMayCompactSections* scenarios and in the bench

## 5. Agent surfaces

- [x] 5.1 Update `server/src/structuredExchangeTool.ts`: description and `document` parameter mention version 3 timelines; `digest` counts tasks, activities, milestones and dependencies and names each unsatisfied dependency; `roleTally` has an explicit timeline arm; verify in a tool test that presenting a timeline returns the digest (*TheAgentIsToldOfUnsatisfiedDependencies*) and a refused one returns rule and pointer
- [x] 5.2 Make `write_structure_figure` and `write_structure_table` refuse a timeline with a reason and no file written (`structuredExchangeExport.ts`, `structuredExchangeTableExport.ts`); verify by tool tests checking the refusal text and that the destination does not exist
- [x] 5.3 Return `unconstrained` for a timeline in `structuredExchangeProfileCheck.ts`; verify a timeline presents in a project with a default profile
- [x] 5.4 Verify a ```` ```structured-exchange ```` reply block holding a timeline is drawn as one (*ATimelineInAReplyIsDrawn*), adding the test beside the existing in-replies tests
- [x] 5.5 Copy `structured-exchange-3.json` into `skills/structured-exchange/`, add a timeline section with the programme example to `skills/structured-exchange/SKILL.md` (and mention timelines in its description), and a version 3 / timeline section to `docs/structured-exchange.md`; verify every fenced JSON example in both validates with the Node check

## 6. Integration

- [x] 6.1 Seed a timeline (with today inside its range, crowded milestones, two separators, one anonymous, dependencies of each type including one unsatisfied and one task endpoint) into the bench transcript (`e2e/fixtures/seeded-transcript.ts`), rebuild `web`, `@pi-outpost/embed`, `build:e2e-host`, then drive it with Playwright on `npm run bench`: scroll to the end and read back that labels stay visible and the today line stays under its date, select items by click and keyboard and read the details and dependency list, then monkey-test (rapid selection, scroll while selected, enlarge/close, toggle text view) and report what broke
- [x] 6.2 Write `openspec/changes/add-structured-exchange-timeline/scenario-coverage.md` mapping every `#### Scenario:` (checked with `rg '^#### Scenario:' openspec/changes/add-structured-exchange-timeline`) to its test, run `npm run check:scenarios`, `npm run lint`, the shared/server/ui suites and `openspec validate add-structured-exchange-timeline --strict`
