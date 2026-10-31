# Tasks

## 1. Routing and rules in `shared/`

- [x] 1.1 Move `server/src/drawioRoutes.ts`, the rule functions of `server/src/drawioAnchors.ts`, the label and same-line rules of `server/src/drawio.ts` and the advice follower now in `server/test/drawioFollowAdvice.ts` to `shared/src/drawio/`, with the server importing them from there (design 2). Verify that the server suite, `server/test/drawioAdvice.test.ts` and `e2e/drawio-routes.spec.ts` (RoutesMatchTheViewer, AnchorWarningsMatchTheViewer) pass unchanged, and that `npm run typecheck` shows no Node import in the moved modules (the UI build compiles them)

## 2. The graph as draw.io cells

- [x] 2.1 Build the cells of a graph (design 1): a vertex per element and container, an orthogonal connector per relationship with its arrangement ends, waypoints and label offset. Route every connector with `routeWire`. Replace `edgePath`'s curves and warping with these routes in `shared/src/structuredExchangeFigure.ts`, keeping self-relationships drawn with extent. Verify WiresRunInStraightSegments and ParallelRelationshipsAreDrawnApart in shared tests, and that every generated connector is routed (none falls outside the port)
- [x] 2.2 Extend `e2e/drawio-routes.spec.ts` with TheRoutesAreDrawioRoutes: the cells of the corpus graphs, written as `.drawio`, are drawn by the vendored viewer along the routes the figure draws. Verify after rebuilding `web`, `@pi-outpost/embed` and `build:e2e-host`

## 3. The arrangement file

- [x] 3.1 Define the format (design 3): its JSON schema, element and relationship keys, reading with unknown entries kept, writing in canonical text. Make the document detector ignore it. Verify AnArrangementWritesTheSameTextTwice, AnArrangementIsNeverReadAsADocument, AnElementKeepsItsPlaceThroughItsReference and the relationship key (a relabelled relationship keeps its key; a re-attached one does not) in shared tests
- [x] 3.2 Document the file in the structured-exchange docs (where it lives, what it holds, that it is presentation only, and versioning it beside the document)

## 4. Placement and cleanup

- [x] 4.1 Incremental placement (design 4, steps 1–4, 6): dagre when nothing is arranged, otherwise fixed arranged boxes and slots for new ones, shifts reported, containers sized around their members. Verify AnAddedElementLeavesTheRestInPlace, ARemovedElementLeavesItsPlaceEmpty and AChangedLabelKeepsTheRoute on a corpus document edited in the test, and determinism (two runs, same cells)
- [x] 4.2 Cleanup (design 4, step 5): run the rules on the cells and follow their advice, bounded, on unarranged wires only. Verify TwoFlowsToOneBoxLeaveFromTheirOwnPoints and AFreshFigureHasNoWireDefectLeftUnreported over the corpus graphs (`notes/figures`, the e2e seeded transcript and the shared fixtures), and that an arranged wire is never changed. Measure the largest corpus graph and record the time in design.md

## 5. The check

- [ ] 5.1 The arrangement check (design 5): the rules' remaining warnings in element labels, entries naming nothing, boxes shifted. Verify AWireThroughABoxIsListed, ACleanArrangementReportsNothing and AnEntryForSomethingGoneIsNamed in shared tests, with the values in each message asserted

## 6. In the view

- [ ] 6.1 Draw graphs in `StructuredExchangeView.tsx` from the arrangement of the selected viewpoint, replacing the nudges. A kept move writes the arrangement through the workspace file API, and a read-only workspace says it cannot keep it. Show the check beside the figure. Verify AMovedBoxIsKeptInTheArrangement and AKeptRepositioningIsNotADocumentChange in UI tests, and in the running app with Playwright (move a box, reload, read the arrangement file and the document bytes back)
- [ ] 6.2 Keep `ARearrangedFigureFitsWhatIsDrawn` and the downloads working from the arrangement. Verify its scenarios and `TheSameArrangedPictureWithoutADisplay` (the downloaded SVG and the figure tool's SVG for the same arrangement draw the same places and routes)

## 7. Touch-up round-trip

- [ ] 7.1 "Arrange in draw.io": serialise the view's cells into a page, open it in the touch-up frame, and read a save back into the arrangement by key, listing content edits as not kept (design 6). Verify ATouchUpIsReadBackByIdentity and AContentEditInDrawioIsNotAModelChange in UI tests, and in the running app: move a box, move a wire end to another side, remove a bend, edit a label, then save, and read back the arrangement, the document and the message shown
- [ ] 7.2 Monkey-test the round-trip in the running app: save twice quickly, close during a save, change the document on disk while touch-up is open, switch viewpoint mid-touch-up. Report what broke and fix it

## 8. The agent's figure tool

- [ ] 8.1 Draw the figure with the viewpoint's arrangement, record computed places when the arrangement's path is writable, and put what was used, what was recorded and the check in the result (design 7). Verify AFigureIsWrittenWithItsArrangement, ANewElementIsRecordedForNextTime, WhatIsLeftIsInTheResult and HiddenKindsKeepTheArrangedPlaces in `server/test/`, with a read-only workspace case where nothing is recorded and the result says so. Update the tool description, `docs/comparison.md`'s character count and the skill that tells the agent to write figures

## 9. Integration

- [ ] 9.1 One live run: ask an agent to write a figure of the vehicle architecture for a Word document, then to add an element as the chief engineer would ask, and write the figure again. Read the transcript, the two figures and the arrangement diff. Insert both figures into a `.docx` and send it to the user to judge in Word desktop
- [ ] 9.2 Write `scenario-coverage.md` covering every scenario from `rg '^#### Scenario:' openspec/changes/structured-exchange-arrangement`, run `node scripts/check-scenario-coverage.mjs --change structured-exchange-arrangement`, `npm run lint`, `npm run typecheck`, the server and UI suites and `openspec validate structured-exchange-arrangement --strict`, all green

## Workflow follow-up

- Land after drawio-wire-anchors (PR #389), which this change builds on; rebase once it is merged.
- Open the PR with a Documentation impact note.
- Archive the change from `main` after merge.
