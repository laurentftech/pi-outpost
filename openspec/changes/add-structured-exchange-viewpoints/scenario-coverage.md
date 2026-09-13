# Scenario coverage — add-structured-exchange-viewpoints

Every scenario the delta declares, and the assertion that would fail if its contract broke. A
scenario is `covered` only when a test's *assertions* check the GIVEN/WHEN/THEN at the boundary the
scenario describes.

Three boundaries carry this change. The contract is tested through the real gate — schema, semantic
rules, the standalone check, the bundled validator and the browser's generated check — over a
conformance corpus. What a viewpoint shows is tested under Node, where the agent's figures are
produced, once for every consumer. Only what needs a mounted component — the selector, the banner, the
copied markup, and the seam between the browser and the serializer — is tested in jsdom.

Capability: `structured-exchange-viewpoints` (31 scenarios).

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AnEnrichedDocumentWithoutViewpointsIsUnchanged | covered | `server/test/structuredExchangeViewpoints.test.ts` — "a version 2 document without them is untouched by their existence" asserts validity and that no empty list is invented; every pre-existing valid version 2 conformance case still passes `server/test/structuredExchangeConformance.test.ts`; and the 51 figures, narrowed figures, exports and diagram exports of every corpus graph were fingerprinted before and after the change and are byte-identical |
| AnEnrichedDocumentMayDeclareViewpoints | covered | `server/test/structuredExchangeViewpoints.test.ts` — "a version 2 graph may declare them" and "and they come back out of validation exactly as they went in"; `server/test/structuredExchangeV2Recovery.test.ts` — "they arrive exactly as they were sent, in the producer's order" (deep equality, id order and key order) and "a reopened session carries the viewpoints a document declared" |
| VersionOneDoesNotAcquireViewpoints | covered | `server/test/structuredExchangeViewpoints.test.ts` — "version 1 does not acquire them" asserts a schema refusal at the envelope; `shared/conformance/invalid/viewpoints-under-version-1.json` refused with `schema/additionalProperties` by the Node validator, the standalone check and the browser check |
| VersionOneIsUntouched | covered | `server/test/structuredExchangeVersionOneFreeze.test.ts` runs every locked version 1 case against its recorded digest and verdict, unchanged by this work |
| AProducerChecksViewpointsOutsideTheApplication | covered | `server/test/structuredExchangeConformance.test.ts` runs `shared/bin/validate-structured-exchange.mjs` on every viewpoint case and asserts the rule and exit status; `server/test/structuredExchangeValidatorCli.test.ts` does the same with the bundled validator; `server/test/structuredExchangeGenerated.test.ts` asserts the browser's generated check matches the Node verdict on each |
| AViewpointRetainsOnlyItsKinds | covered | `server/test/structuredExchangeViewpointFigure.test.ts` — "it shows exactly the elements and relationships of the kinds it retains" asserts the exact node and edge sets |
| AVocabularyTheViewpointDoesNotNameIsLeftWhole | covered | `server/test/structuredExchangeViewpointFigure.test.ts` — "a vocabulary it names no kinds for is left whole" asserts every relationship between shown elements remains |
| VocabulariesStayIndependent | covered | `server/test/structuredExchangeViewpointFigure.test.ts` — "the two vocabularies stay independent" asserts `element:power` is not hidden while `relationship:power` is; `server/test/structuredExchangeViewpoints.test.ts` — "a name that exists only in the other vocabulary is not the same kind" |
| AKindlessElementIsNotHiddenByAViewpoint | covered | `server/test/structuredExchangeViewpointFigure.test.ts` — "a thing with no kind is not hidden by a viewpoint", including that a kindless relationship still goes with a hidden endpoint |
| AKindAddedLaterIsNotShownUnannounced | covered | `server/test/structuredExchangeViewpointFigure.test.ts` — "a kind added to the model later is not shown unannounced" adds a storage element and a power edge to it and asserts neither is shown |
| AViewpointNamingAnAbsentKindIsRefused | covered | `server/test/structuredExchangeViewpoints.test.ts` — "a viewpoint naming an element kind no element has" (rule, pointer `/viewpoints/0/elementKinds/1`, and the kind named) and "a viewpoint naming a relationship kind no relationship has"; `shared/conformance/invalid/v2-viewpoint-retaining-an-absent-kind.json` |
| ANearMissKindIsNotCorrected | covered | `server/test/structuredExchangeViewpoints.test.ts` — "a near-miss kind is refused, and nothing is substituted for it" asserts the only rule is `unresolved-viewpoint-kind` and the message proposes no correction |
| DuplicateViewpointIdentifiersAreRefused | covered | `server/test/structuredExchangeViewpoints.test.ts` — "two viewpoints sharing an identifier, pointing at the second" asserts pointer `/viewpoints/1/id` and the first's location; `shared/conformance/invalid/v2-viewpoints-sharing-an-identifier.json` |
| AViewpointRetainingNothingIsRefused | covered | `server/test/structuredExchangeViewpoints.test.ts` — "a viewpoint retaining no kind at all" asserts `empty-viewpoint` at `/viewpoints/0`; "a kind list, when present, names at least one kind and names it once" refuses an empty and a duplicated list; `shared/conformance/invalid/v2-viewpoint-retaining-nothing.json` and `v2-viewpoint-listing-a-kind-twice.json` |
| ViewpointsOutsideAGraphAreRefused | covered | `server/test/structuredExchangeViewpoints.test.ts` — "viewpoints on a document that is not a graph" asserts `viewpoints-without-graph` at `/viewpoints` for a sequence and a table; `shared/conformance/invalid/v2-viewpoints-on-a-table.json` |
| ViewpointsAreBounded | covered | `server/test/structuredExchangeViewpoints.test.ts` — "at the ceiling on viewpoints per document, and not one past it", "at the ceiling on a viewpoint's concern, and not one character past it", "a viewpoint retains no more kinds than a vocabulary can hold apart" and "a viewpoint's label is bounded like every other label" each assert the refusing rule and the ceiling it names; `server/test/structuredExchangeV2Schema.test.ts` mirrors the ceilings against the schema |
| TheWholeDocumentIsShownUntilAViewpointIsSelected | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "shows the whole document until a viewpoint is selected" asserts the selector's value, every element drawn, and no banner |
| SelectingAViewpointNarrowsToIt | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "narrows the rendering to what it retains" asserts the exact drawn elements for two viewpoints in turn |
| TheRenderingSaysWhichViewpointItShows | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "says which viewpoint is shown and what it is for, on the page and inside the figure" asserts the banner's label and concern and the figure's own statement |
| TheKeyStillAppliesOnTopOfAViewpoint | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "lets the key hide more on top, and says the viewpoint has been adjusted" asserts no "Adjusted" before, the extra element gone after, and "Adjusted" in both the banner and the figure |
| ReturningToTheWholeDocument | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "returns to the whole document in one action, from the selector or the banner" asserts every element drawn, no banner, the selector reset and no figure statement, by both routes |
| ADocumentWithoutViewpointsOffersNoSelection | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "offers nothing when the document declares no viewpoints" |
| SelectingAViewpointDoesNotAlterTheDocument | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "leaves the document being approved untouched" asserts the item's payload is character-for-character the producer's after selecting and adjusting |
| AnExportedFigureNamesItsViewpoint | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "copies markup that states the selected viewpoint" asserts the clipboard receives the viewpoint's label and concern |
| AProposalFigureStillSaysHiddenKindsRemain | covered | `server/test/structuredExchangeViewpointFigure.test.ts` — "a proposal's figure still says hidden kinds remain part of the proposal" asserts the statement opens with the viewpoint and keeps the proposal caveat |
| TheReaderAndTheAgentProduceTheSameViewpointFigure | covered | `ui/src/presentations/figureSeam.test.tsx` — "draws what the reader selects exactly as the agent writes it" selects through the real selector, asserts both figures are narrowed and state the viewpoint, then compares every shape and the canvas |
| AFigureIsWrittenForADeclaredViewpoint | covered | `server/test/structuredExchangeFigureToolViewpoints.test.ts` — "writes the figure a declared viewpoint describes" asserts the written SVG states the viewpoint and concern and contains exactly its three elements |
| AnUndeclaredViewpointIsRefusedWithTheDeclaredOnes | covered | `server/test/structuredExchangeFigureToolViewpoints.test.ts` — "refuses a viewpoint the document does not declare, listing the ones it does" asserts the error, the declared ids, and that no file exists |
| ADocumentWithoutViewpointsRefusesOne | covered | `server/test/structuredExchangeFigureToolViewpoints.test.ts` — "refuses any viewpoint for a document that declares none, saying so" asserts the message and that no file exists |
| HiddenKindsApplyOnTopOfAViewpoint | covered | `server/test/structuredExchangeFigureToolViewpoints.test.ts` — "applies hidden kinds on top of the viewpoint" asserts the extra element is absent and the figure says "(adjusted)"; `server/test/structuredExchangeViewpointFigure.test.ts` — "hidden kinds named beside a viewpoint apply on top of it" |
| TheResultNamesTheViewpoint | covered | `server/test/structuredExchangeFigureToolViewpoints.test.ts` — "names the viewpoint in its result" asserts the result line naming the id and label, with the coverage |

Capability: `structured-exchange` — the two modified requirements.

`ReaderMayAdjustAndNarrowTheView` adds selecting a declared viewpoint to the adjustments a reader may
make; `AdjustmentDoesNotAlterTheDocument` now reads "repositions, turns, narrows or selects a
viewpoint". `TheAgentCanWriteAFigureToAPath` lets the request name a declared viewpoint and gains one
scenario.

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| EverythingIsShownUntilTheReaderNarrowsIt | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "shows everything until the reader hides something" (unchanged) |
| NarrowingIsReversibleAndDeclared | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "hides a type when its key entry is clicked, and brings it back on a second click" and "says on screen that the picture is no longer the whole document" (unchanged) |
| ANarrowedProposalStillSaysWhatItProposes | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "says on a proposal that a hidden type is still part of it" and "keeps a hidden type in the key, marked hidden, so an exported figure says what is missing" (unchanged) |
| ElementAndRelationshipVocabulariesAreIndependent | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "hides a relationship type without hiding an element type of the same name" (unchanged) |
| AdjustmentDoesNotAlterTheDocument | covered | `ui/src/presentations/structuredExchangeViewpoints.test.tsx` — "leaves the document being approved untouched" covers selecting a viewpoint; `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "leaves the document itself untouched" covers turning; `ui/src/presentations/StructuredExchangeView.test.tsx` — "is recoverable as validated, after being validated and rendered" covers repositioning and narrowing |
| ATableNarrowsByRole | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "hides the rows of a role the reader switches off, and says it is doing so" (unchanged) |
| AHiddenRoleIsNotARemovedRow | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "presents each declared role differently, and strikes a removed row through" (unchanged) |
| AFigureIsWrittenWhereTheAgentAsked | covered | `server/test/structuredExchangeFigureTool.test.ts` — "writes the figure where the agent asked" (unchanged) |
| TheNarrowingIsTheReadersNarrowing | covered | `server/test/structuredExchangeFigureTool.test.ts` — "the two hide lists are separate vocabularies" (unchanged) |
| NoNarrowingMeansTheWholeDocument | covered | `server/test/structuredExchangeFigureTool.test.ts` — "no narrowing draws the whole document, and says so" (unchanged) |
| WritingOutsideTheWritableZoneIsRefused | covered | `server/test/structuredExchangeFigureTool.test.ts` — "a path outside the writable zone is refused, naming the confinement" (unchanged) |
| TheResultSaysHowMuchItShows | covered | `server/test/structuredExchangeFigureTool.test.ts` — "the result states how much of the document the figure shows" (unchanged) |
| ANarrowingThatHidesEverythingIsReportedNotDrawn | covered | `server/test/structuredExchangeFigureTool.test.ts` — "a narrowing that leaves nothing is reported, and nothing is written" (unchanged) |
| ARequestMayNameADeclaredViewpoint | covered | `server/test/structuredExchangeFigureToolViewpoints.test.ts` — "writes the figure a declared viewpoint describes" and "names the viewpoint in its result" |
