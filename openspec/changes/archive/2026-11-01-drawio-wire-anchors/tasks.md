# Tasks

## 1. Rules and calibration

- [x] 1.1 Create `wireAnchorIssues(wires, terminals)` beside `server/src/drawioRoutes.ts`, holding the shared-point, facing-away and detour rules as design.md states them (drawn points grouped within one unit on rounded coordinates, labels normalised, free points among 0.25/0.5/0.75, corners skipped, `2·d` and `+80` for detours). Verify with unit tests in `server/test/drawioWires.test.ts` for each scenario of the three new requirements, including the same-label exception, unlabelled wires, ends without fixed points that draw.io lands on one point, a full side, and overlapping ends
- [x] 1.2 Run the three rules over `server/test/fixtures/drawio/*.drawio` and the generated corpus, and read every warning against the drawn diagram. Keep the 2× / 80-unit thresholds only if no warning is one a reader would call fine; otherwise change them here and in the delta spec. Record what each fixture reports in the PR description

## 2. In drawio_check

- [x] 2.1 Call `wireAnchorIssues` from `checkWires` in `server/src/drawio.ts` with the port's routes, skipping the facing-away rule for a wire that already got the own-ends warning. Verify in `server/test/drawioWires.test.ts` that `checkDrawio` reports each warning with the wire ids, shape ids and the proposed values in its message, that "AClearDiagramStaysClean" and "AnUnroutedWireIsLeftAlone" still hold, and that a wire never gets both the own-ends and the facing-away message
- [x] 2.2 Extend `e2e/drawio-routes.spec.ts` with AnchorWarningsMatchTheViewer: the rules evaluated on the viewer's routes and on the port's give the same warnings over the same corpus, with a floor on how many of each warning the corpus produces, so the test cannot pass on a corpus that never triggers them. Verify with `npx playwright test drawio-routes` after rebuilding `web`, `@pi-outpost/embed` and `build:e2e-host`

## 3. Skill and documentation

- [x] 3.1 Add the two Layout bullets to `skills/drawio/SKILL.md` (one point per data flow unless it is the same label; leave a box on the side facing where the wire goes), and update any user document that lists what `drawio_check` warns about (`rg -n "drawio_check" README.md docs`). Verify that the skill's wording matches the warning messages

## 4. Coverage and the running agent

- [x] 4.1 Write `openspec/changes/drawio-wire-anchors/scenario-coverage.md` covering every scenario from `rg '^#### Scenario:' openspec/changes/drawio-wire-anchors`; verify with `node scripts/check-scenario-coverage.mjs --change drawio-wire-anchors`
- [x] 4.2 One live run in the app: ask an agent for a diagram with several flows between the same boxes, then read the session transcript to check that `drawio_check` raised the new warnings and that the agent's rewrite moved the points as proposed. Report what the agent did, whether or not it fixed them
- [x] 4.3 Run `npm run lint`, `npm run typecheck`, the server suite and `openspec validate drawio-wire-anchors --strict`, all green

## 5. What the live runs showed on pi-outpost's side

- [x] 5.1 Make `drawio_check` wait for a write or edit of its file sent in the same message (`server/src/pendingWrites.ts`, hooks in the embedded runtime's extension factories and in `piOutpostTools.ts` for an RPC child); verify with "ACheckWaitsForAWriteInFlight" in `server/test/drawio.test.ts` (deterministic, fails without the wait) and `server/test/drawioCheckWaitsWire.test.mjs` (real runtime, edit and check in one message through the scripted provider, fails without the hook)
- [x] 5.2 List each page's warnings in fixing order and say so in the report, with the edit hint for connectors; verify with "TheReportListsFixesInOrder" and "A report about connectors says how to edit one…" in `server/test/drawioWires.test.ts` (the order test fails without the sort)
- [x] 5.3 Count every cell under a wire as its label, whatever its geometry; verify with "A wire's label cell counts as its label however it is placed" in `server/test/drawioWires.test.ts`
- [x] 5.4 Make the anchor advice converge when followed to the letter: distinct points across the groups of a shape, seven positions per side before another side, another side given as values, and waypoints named when they cause a wire through its own ends; verify with `server/test/drawioAdvice.test.ts` (FollowingTheAdviceConverges on the Codestral and live-run diagrams, fails without the per-side bookkeeping) and "WaypointsThroughTheEndsAreNamed" in `server/test/drawioWires.test.ts`
- [x] 5.5 Compare paths with links resolved in the write registry; verify that `server/test/drawioCheckWaitsWire.test.mjs`, now on the unresolved temporary path, fails without it and passes with it
- [x] 5.6 Warn about needless bends left by waypoints, with a fix tried on the route before it is given; verify with the "needless bends" tests in `server/test/drawioWires.test.ts` and with FollowingTheAdviceConverges on the four Luna diagrams (`server/test/fixtures/drawio-advice/luna-*.drawio`)
- [x] 5.7 In touch-up, "remove bends" for the selected wires or the page, and click on a bend's handle then Delete for one; verify with "TheBendsOfWiresAreRemoved" in `ui/src/components/DrawioBlock.test.tsx`, and in the running app with "TheBendsOfWiresAreRemoved" and "ABendIsRemovedByClickAndDelete" in `e2e/drawio-conversation.spec.ts` (the whole file green)
- [x] 5.8 Warn about labels on labels, labels across wires and different-data wires along the same line (Luna's "services" diagram), with fixes tried on the routes and kept clear of each other within a pass; verify with LabelsOnLabelsAreWarned, ALabelAcrossAWireIsWarned, AWireAlongAnotherIsWarned and TheSameDataMayShareALine in `server/test/drawioAdvice.test.ts`, and FollowingTheAdviceConverges, now strict on the Luna diagrams

## Workflow follow-up

- Open the PR with a Documentation impact note.
- Archive the change from `main` after merge.
