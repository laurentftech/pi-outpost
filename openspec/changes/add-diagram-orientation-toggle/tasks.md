## 1. The rule, written once

- [x] 1.1 Measured the reading column in the running bench: a structured-exchange block is 710 px wide inside the `max-w-3xl` conversation column, drawn at natural size in an `overflow-x-auto` box (a Mermaid block shrinks instead, `[&_svg]:max-w-full`). `READING_WIDTH = 710`, recorded in design.md.
- [x] 1.2 Add `Orientation` (`"landscape" | "portrait"`) and `orientationFor(widthLandscape, widthPortrait)` to `shared/src`, implementing the predicate from design.md — landscape while it fits `READING_WIDTH`, portrait only when it is clearly narrower — and verify with unit tests covering: a layout that fits, one that overflows and gains by turning, one that overflows and gains nothing, and the same inputs twice (`ChoiceIsDeterministic`).

## 2. The graph rendering

- [x] 2.1 `layoutGraph` in `shared/src/structuredExchangeModel.ts` takes the orientation and passes the matching `rankdir` to dagre, defaulting to landscape; verify the existing `structuredExchange.test.ts` layout tests still pass unchanged.
- [x] 2.2 Add a portrait test for `layoutGraph`: the same graph laid out portrait places its ranks down rather than across, and its extent is taller than wide where landscape's was wider than tall.
- [x] 2.3 `graphFigure` in `shared/src/structuredExchangeFigure.ts` accepts `orientation` in `GraphFigureOptions`; when none is given it lays out both ways and applies `orientationFor` (`OrientationIsChosenForLegibility`). Verify with a figure test: a wide graph comes out portrait, a small one landscape, with no caller passing anything.
- [x] 2.4 Verify the routing holds portrait — edges connect box borders, self-loops still draw, containers still enclose their members — with a figure test over a graph that has a container, two edges between one pair, and a self-loop.
- [x] 2.5 Verify `TheSameContentEitherWay` and `NarrowingSurvivesTheTurn` at the figure level: the same document drawn both ways carries the same elements, relationships, containers, labels, colours and key, and a narrowed figure still states what it is not showing.

## 3. The reader's control on the structured-exchange view

- [x] 3.1 Hold the reader's orientation in `StructuredExchangeDocument` beside `nudges` and `hidden` (`ui/src/presentations/StructuredExchangeView.tsx`), pass it to both the inline and the enlarged rendering, and verify with a test that turning the inline one turns the enlarged one.
- [x] 3.2 Add the control beside `⤢ enlarge`, shown only for a graph, naming the orientation currently drawn; verify a table and a sequence offer no control (`ASequenceOffersNoOrientation`, `ATableOffersNoOrientation`).
- [x] 3.3 Clear the nudges when the orientation changes, and verify `TurningStartsFromTheComputedLayout`: a repositioned box, turned, is drawn where the new layout puts it.
- [x] 3.4 Verify `TheExportIsWhatIsShown`: the downloaded SVG and the copied markup of a turned rendering are the turned figure.
- [x] 3.5 Verify `SwitchingDoesNotAlterTheDocument`: the envelope recovered for handover after turning is byte-identical to the one before.

## 4. Mermaid

- [x] 4.1 Add direction rewriting to `ui/src/components/Mermaid.tsx`'s module: recognise a `flowchart`/`graph` header direction and a top-level `stateDiagram-v2` `direction` statement (inserting one when absent), map `LR`↔`TB`, `RL`↔`BT`, treat `TD` as `TB`, and leave a `direction` inside a `subgraph` untouched. Verify with unit tests over each shape, including a source it does not recognise, which must come back unchanged.
- [x] 4.2 Report orientability from the same module — `flowchart`, `graph`, `stateDiagram-v2` yes; `sequenceDiagram`, `pie`, `gantt`, `classDiagram` and anything unrecognised no — and verify `ANotationWithNoDirectionIsLeftAlone` with a test per notation.
- [x] 4.3 Measure the rendered diagram from its `viewBox` (width and height, extending `naturalWidth`'s reader) and re-render with the direction swapped when `orientationFor` says the drawn one loses, keeping the second render only when it is actually narrower. Verify `AnUnreadableAuthoredDirectionIsOverridden` and `AReadableAuthoredDirectionIsKept` against a stubbed renderer that returns a wide and a narrow `viewBox`.
- [x] 4.4 Add the orientation control to the Mermaid block, shown only for an orientable source, and verify `TheReaderOverridesTheAutomaticChoice` — an auto-turned diagram switched back is rendered from the authored direction.
- [x] 4.5 State on the block when the diagram is drawn against the direction its source asks for (`AnOverriddenDiagramSaysSo`), and verify `TheAuthoredSourceIsWhatTheReaderGets`: `⌗ code` and the copy button still carry the authored source with its original direction.

## 5. Coverage, documentation and proof in the running app

- [x] 5.1 Write `openspec/changes/add-diagram-orientation-toggle/scenario-coverage.md` mapping all 18 scenarios of `diagram-orientation` plus the amended `ReaderMayAdjustAndNarrowTheView` to their tests, and verify with `npm run check:scenarios`.
- [x] 5.2 Run `npm run lint`, `npm run tsc` (or the repo's typecheck script) and the full unit suites for `shared`, `ui` and `server`, and report the counts.
- [x] 5.3 Review the diff for documented behaviour — `README.md`, `docs/`, the structured-exchange skill — update what the orientation control changes, and record the `Documentation impact` note for the PR.
- [x] 5.4 Rebuild `web`, then `@pi-outpost/embed`, then `build:e2e-host`; run `npm run bench` and drive both surfaces in the widget: a wide graph arrives portrait, turning it works inline and enlarged, a Mermaid `flowchart LR` too wide to read arrives turned and says so, and the copied source is the authored one. Read back the DOM, not a screenshot.
- [x] 5.5 Second pass in the bench with the aim of breaking it: turn while dragging a box, turn while a narrowing is applied, turn in the enlarged view then close it, spam the control, turn a diagram that is still streaming, and turn one whose source is invalid. Report what broke rather than that it works.
- [x] 5.6 Add a Playwright spec covering the turn on both surfaces in the seeded transcript, scoped by content rather than by position, and verify it passes in `browser`.
