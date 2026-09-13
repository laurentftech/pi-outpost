## 1. Contract

- [x] 1.1 Add the optional `viewpoints` envelope property to `shared/schemas/structured-exchange-2.json` (D3): `id` reusing `localId`, `label` reusing `label`, a required bounded `concern`, optional `elementKinds` and `relationshipKinds` reusing `kind`, strict object shape. Verify the existing valid version 2 conformance cases still validate unchanged.
- [x] 1.2 Regenerate the version 2 validator with `node --import tsx/esm shared/scripts/generate-structured-exchange-check.mjs`, and verify `server/test/structuredExchangeGenerated.test.ts`, which fails when `shared/src/generated/structuredExchangeCheck2.ts` drifts from the committed schema, passes.
- [x] 1.3 Add the viewpoint ceilings to `STRUCTURED_EXCHANGE_CEILINGS_2` (D6: 20 per document, kinds per viewpoint bounded by `kindsPerVocabulary`, `concern` 500) and the mirrored `StructuredViewpoint` type in `shared/src/structuredExchange.ts`; enforce them pre- and post-parse in `structuredExchangeBounds.ts`. Verify with bounds tests at each ceiling and one past it (`ViewpointsAreBounded`).
- [x] 1.4 Prove version 1 is untouched: a version 1 document carrying `viewpoints` is refused, and the frozen corpus still passes `structuredExchangeVersionOneFreeze.test.ts` unchanged (`VersionOneDoesNotAcquireViewpoints`, `VersionOneIsUntouched`).

## 2. Semantic rules

- [x] 2.1 Add `unresolved-viewpoint-kind` to `validateStructuredExchangeSemantics`, checked per vocabulary, pointing at the offending kind; verify with tests for an absent element kind, an absent relationship kind, a name present only in the other vocabulary, and a one-character near miss that is refused and never substituted (`AViewpointNamingAnAbsentKindIsRefused`, `ANearMissKindIsNotCorrected`).
- [x] 2.2 Add `duplicate-viewpoint-identifier` (pointing at the second), `empty-viewpoint`, and `viewpoints-without-graph`; verify each with a test naming the rule and pointer (`DuplicateViewpointIdentifiersAreRefused`, `AViewpointRetainingNothingIsRefused`, `ViewpointsOutsideAGraphAreRefused`).
- [x] 2.3 Add valid and invalid version 2 conformance cases for viewpoints under `shared/conformance/valid` and `invalid`, registered in `index.json` with their expected rules, and verify the conformance suite passes with the version 1 lock unchanged.
- [x] 2.4 Verify the standalone producer check reaches the same verdicts and diagnostics as the application on those cases: `shared/bin/validate-structured-exchange.mjs` through `server/test/structuredExchangeConformance.test.ts`, and the bundled validator through `npm run build:validator` and `server/test/structuredExchangeValidatorCli.test.ts` (`AProducerChecksViewpointsOutsideTheApplication`).

## 3. One resolution for every consumer

- [x] 3.1 Add `resolveViewpoint(data, viewpoint): Narrowing` beside `shownGraph` (D4): per constrained vocabulary, every present kind not retained, as `filterKey` entries; an unconstrained vocabulary contributes nothing. Verify under Node: retained kinds only, an unnamed vocabulary left whole, independent vocabularies, a kind-less element still shown, a relationship hidden with its hidden endpoint, and a kind added after the viewpoint was written hidden (`AViewpointRetainsOnlyItsKinds`, `AVocabularyTheViewpointDoesNotNameIsLeftWhole`, `VocabulariesStayIndependent`, `AKindlessElementIsNotHiddenByAViewpoint`, `AKindAddedLaterIsNotShownUnannounced`).
- [x] 3.2 Give `GraphFigureOptions` and `FigureNarrowing` an optional `viewpoint`, and make `graphFigure`'s statement begin with the viewpoint's label and concern, keep the counts and the proposal caveat, and say "adjusted" when further kinds are hidden (D8). Verify under Node (`AProposalFigureStillSaysHiddenKindsRemain`).
- [x] 3.3 Verify viewpoints survive validation, live transport, history restoration and recovery unaltered, and that a version 2 document without viewpoints produces byte-identical figures and exports to before (`AnEnrichedDocumentMayDeclareViewpoints`, `AnEnrichedDocumentWithoutViewpointsIsUnchanged`).

## 4. The reader

- [x] 4.1 Add `selectedViewpoint` beside `hidden` in `StructuredExchangeDocument` and a native `<select>` offering "Whole document" and each declared viewpoint, only when viewpoints exist (D7). Verify in jsdom: the whole document shown first, no control without viewpoints (`TheWholeDocumentIsShownUntilAViewpointIsSelected`, `ADocumentWithoutViewpointsOffersNoSelection`).
- [x] 4.2 Make selecting a viewpoint replace `hidden` with its resolution, keep the key's toggles editing `hidden` on top, and derive "adjusted" by comparing `hidden` with the resolution. Verify selecting, adjusting with the key, and returning to the whole document (`SelectingAViewpointNarrowsToIt`, `TheKeyStillAppliesOnTopOfAViewpoint`, `ReturningToTheWholeDocument`).
- [x] 4.3 State the selected viewpoint's label and concern in the rendering, and verify it along with the document recovered for handover being unchanged after selection (`TheRenderingSaysWhichViewpointItShows`, `SelectingAViewpointDoesNotAlterTheDocument`).
- [x] 4.4 Verify the downloaded and copied SVG of a selected viewpoint state it (`AnExportedFigureNamesItsViewpoint`).

## 5. The agent

- [x] 5.1 Add the optional `viewpoint` parameter to `write_structure_figure` (D9): refuse an undeclared id listing the declared ones, refuse any id for a document declaring none, union hide lists on top, write nothing on refusal, and name the viewpoint in the result. Verify each through the tool (`AFigureIsWrittenForADeclaredViewpoint`, `AnUndeclaredViewpointIsRefusedWithTheDeclaredOnes`, `ADocumentWithoutViewpointsRefusesOne`, `HiddenKindsApplyOnTopOfAViewpoint`, `TheResultNamesTheViewpoint`, `ARequestMayNameADeclaredViewpoint`).
- [x] 5.2 Verify the reader's exported figure and the agent's written figure for the same viewpoint of the same document show the same elements, relationships, labels and statement (`TheReaderAndTheAgentProduceTheSameViewpointFigure`).
- [x] 5.3 Update the contract text the agent reads — `present_structure`'s document description and `write_structure_figure`'s description — to show a viewpoint and teach one figure per viewpoint, and verify the tool definition tests.

## 6. Documentation, coverage and running-app proof

- [x] 6.1 Document viewpoints in `skills/structured-exchange/SKILL.md` and `docs/structured-exchange.md` with a worked example, including that a kind-less element survives every viewpoint; verify the fenced JSON validates with the standalone check and the packaged contract still passes `scripts/check-cli-package.mjs`.
- [x] 6.2 Write `openspec/changes/add-structured-exchange-viewpoints/scenario-coverage.md` mapping all 31 scenarios of `structured-exchange-viewpoints` and the amended `ReaderMayAdjustAndNarrowTheView` and `TheAgentCanWriteAFigureToAPath`, and verify with `npm run check:scenarios`.
- [ ] 6.3 Run `npm run lint`, `npm run typecheck`, and the full `shared`, `ui` and `server` suites, and report the counts.
- [ ] 6.4 Add a viewpoint-declaring graph to the seeded transcript, rebuild `web`, `@pi-outpost/embed` and `build:e2e-host`, run `npm run bench`, and drive it: select a viewpoint, adjust with the key, return to the whole document, download the figure. Read back the DOM and the SVG, not a screenshot.
- [ ] 6.5 Second pass in the bench aimed at breaking it: switch viewpoint while dragging, while enlarged, while turned, spam the selector, select then hide every remaining kind, and select on a proposal. Report what broke.
- [ ] 6.6 Add a Playwright spec selecting a viewpoint in the seeded transcript, scoped by content, and verify it passes in `browser`.
