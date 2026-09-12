# Scenario coverage — extend-structured-exchange-contract

Every scenario the delta declares, and the assertion that would fail if its contract
broke. A scenario is `covered` only when a test's *assertions* — not its name — check
the GIVEN/WHEN/THEN at the boundary the scenario describes. Rows marked `uncovered`
are gaps found by building this table, not scenarios that were meant to be skipped.

Capability: `structured-exchange-context` (49 scenarios).

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| VersionOneRemainsValid | covered | `server/test/structuredExchangeVersionDispatch.test.ts` — "a version 1 document is still judged by version 1" asserts the v1 envelope draws no issues; `server/test/structuredExchangeVersionOneFreeze.test.ts` re-runs all 49 frozen cases against their recorded verdicts |
| VersionTwoSelectsItsOwnContract | covered | `server/test/structuredExchangeVersionDispatch.test.ts` — "a version 2 document is judged by version 2" and "version 1 does not inherit version 2's vocabulary" (v2 fields under a v1 identifier still refused) |
| ValidationStaysOffline | covered | `server/test/structuredExchangeNoRetrieval.test.ts` — "a document dense with addresses validates without a single request or read" stubs the network and filesystem and asserts neither is touched |
| UnknownProfileUsesGenericPresentation | covered | `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "names the vocabulary without claiming to understand it" |
| ProfileDoesNotSupplyExecutableBehavior | covered | `server/test/structuredExchangeNoRetrieval.test.ts` — "a profile that looks executable is text like any other"; `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` renders markup-like producer text inert |
| ProfileIsOptional | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "attributes need no profile to be carried" asserts a document with attributes and no profile validates, and that the model reports no profile rather than inventing one |
| AttributesRemainDomainOwned | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "what the producer says is true now" asserts the exact attribute pairs reach the model unread; "attributes keep the producer's order rather than being sorted" |
| AttributeChangeIsExplicit | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "what it asks to become true" (assignments held apart from description); `server/test/structuredExchangeV2Semantics.test.ts` — "a change alone is the proposal, and its role follows from it" |
| OmittedAttributeRemainsUntouched | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "an attribute the patch does not mention is not touched" asserts a `set` naming one attribute leaves the others out of both assignments and removals |
| AttributeRemovalIsExplicit | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "and what it asks to unset, which is not an assignment of null"; `server/test/structuredExchangeV2Semantics.test.ts` — "null is a value, not a deletion" |
| ContradictoryAttributeChangeIsRejected | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "assigning and removing the same attribute is refused" (rule `attribute-set-and-removed`, pointing at the offending name) |
| RecursiveAttributeValueIsRejected | covered | `server/test/structuredExchangeV2Bounds.test.ts` — "a list inside a list"; `server/test/structuredExchangeV2Schema.test.ts` — "an attribute value cannot nest another list" walks the schema |
| RevisionTravelsWithProposal | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "a proposal carries the artifact it targets and the revision it was read at"; `server/test/structuredExchangeV2Recovery.test.ts` — deep equality across the wire and the replay |
| RevisionDoesNotDefineProposalMode | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a target is what makes a proposal, and a revision alone is not one" asserts a revision is only reachable inside a target and that presence of `target` is the discriminator |
| ExpectationIsNotPresentedAsAChange | covered | `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "keeps description, expectation, assignment and removal apart"; `server/test/structuredExchangeV2Presentation.test.ts` — the four fields asserted separately |
| ExpectationOutsideProposalIsRejected | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "an expectation in a document that targets nothing is refused" and "an expectation on an item that references nothing is refused" |
| AuthorityCanReceiveConcurrencyContext | covered | `server/test/structuredExchangeV2Recovery.test.ts` — "the document that arrives is the document that was sent" and "a reopened session carries the enriched document", both by deep equality including `expect` and `target.revision` |
| LocationDoesNotBecomeIdentity | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a location takes no part in identity" asserts two rows with the same location and different refs are accepted, and that a relation endpoint is never matched by location |
| StaleLocationDoesNotChangeReference | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a location whose revision has moved on changes nothing about the reference" |
| InvalidRangeIsRejected | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a range that ends before it begins is refused" and the within-a-line case (rule `location-range-reversed`) |
| NavigationRequiresReaderAction | covered | `ui/src/presentations/structuredExchangeNavigation.test.tsx` — "asks the application for nothing until a control is used" and "renders a location and an artifact without fetching either" (fetch stubbed, never called) |
| ArtifactLinkIsPresentedWithoutRetrieval | covered | `ui/src/presentations/structuredExchangeNavigation.test.tsx` — "does not open an artifact's bytes to show that it has a digest"; `server/test/structuredExchangeNoRetrieval.test.ts` — "a digest is checked against bytes nobody fetched" |
| EmbeddedArtifactPayloadIsRejected | covered | `server/test/structuredExchangeV2Schema.test.ts` — "an artifact names bytes and never carries them" asserts an inline payload field is refused; `shared/conformance/invalid/v2-artifact-without-a-digest.json` |
| DigestMismatchPreventsUse | covered | `server/test/structuredExchangeArtifactDigest.test.mjs` — "bytes that are not the approved ones are refused rather than shown" and "a file that changes after the document was written stops opening", over the socket against real files |
| GenericPresentationShowsEnrichment | covered | `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "says what the document is before what it holds", "carries locations and artifacts, digest included", "carries a list attribute whole" |
| ProposalSeparatesConditionsFromChanges | covered | `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "tells the four kinds of claim apart by word, not only by colour" |
| EnrichmentSurvivesApproval | covered | `server/test/structuredExchangeV2Recovery.test.ts` — deep equality through the wire and the history replay, with key order and nulls asserted |
| ProducerTextRemainsInert | covered | `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "renders a location and a digest as text, not as anything that acts" |
| AVersionOneDocumentReExpressedLosesNothing | covered | `server/test/structuredExchangeV2Schema.test.ts` — "the enriched schema accepts what version 1 accepted" runs every valid conformance fixture with only the identifier changed |
| AnEnrichedFigureDrawsTheSameStructure | covered | `server/test/structuredExchangeV2DerivedViews.test.ts` — "and it draws the same structure as the version 1 equivalent" compares the two SVGs |
| AnEnrichedTableLeavesAsData | covered | `ui/src/presentations/tableExport.test.ts` — "gives a chaptered table columns for the section and its level" and the role/plain cases |
| ARequirementRowIsAddressable | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "identity and type survive into the model" (id, ref, kind, cells) |
| DuplicateRowIdsAreRejected | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "two rows sharing an identifier are refused", asserting rule and pointer |
| ATypedRowStillAlignsToItsColumns | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a data row is still held to them" (rule `row-column-mismatch`) |
| AnEnrichedTableCanBeProposed | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "an enriched table may be proposed and its rows patched" |
| ARowKindIsNotInferredFromData | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a row's kind is never inferred from what a column says" asserts a table whose cells name types produces no typed rows |
| ARequirementIsLinkedToWhatSatisfiesIt | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "a relation between two rows names both, with the text a reader sees"; `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — both directions |
| ARelationMayLeaveTheDocument | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "an end naming something outside the document is accepted" and "both ends may leave the document" |
| AnUnresolvableEndpointIsRejected | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "an end naming a row that does not exist is refused, and says which end" |
| TheKeyNamesEveryRelationKindShown | covered | `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "shows a row's relations in both directions, and keys the vocabulary" |
| MissingTraceabilityIsNotAFinding | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a row in no relation is accepted, and nothing is said about its coverage" |
| ChaptersDivideARequirementsTable | covered | `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "draws a chapter across the table rather than as a row of data"; `server/test/structuredExchangeV2Presentation.test.ts` — position and depth |
| AStructuralRowNeedsNoCells | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a heading needs no cells and is not held to the columns" |
| ExportsKeepTheChapters | covered | `ui/src/presentations/tableExport.test.ts` — "keeps each heading in its place among the rows it introduces"; `ui/src/presentations/structuredExchangeEnrichedText.test.tsx` — "keeps the chapters, in place and at their depth" |
| AnEmptyDataRowIsNotAChapter | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "a data row is never given a heading it did not declare" |
| AnEnrichedTableCarriesATargetAndRevision | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a version 2 table carrying a target is accepted"; `server/test/structuredExchangeV2Presentation.test.ts` — target and revision reach the model |
| AVersionOneTableStillCannotBeProposed | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a version 1 table carrying a target is still refused" (rule `kind-not-proposable`) |
| ARowThatReportsAndAsksAtOnceIsRefused | covered | `server/test/structuredExchangeV2Semantics.test.ts` — "a declared role beside a change is refused" (rule `role-with-change`, pointing at the row) |
| AProposedRowIsMarkedFromWhatItProposes | covered | `server/test/structuredExchangeV2Presentation.test.ts` — "a referenced row carrying a change reads as changed", "a row with no reference reads as an addition", "a referenced row with no change reads as context, not as a rewrite", "a chapter is not marked as proposed" |

## What building this table found

Nine rows had no assertion behind them when the matrix was first written — the
scenarios were real and the tests were about something adjacent. Each was then
written rather than argued away:

- `OmittedAttributeRemainsUntouched` — the patch semantics every other rule depends on.
- `RevisionDoesNotDefineProposalMode` — a revision rides inside a target; presence of the target is what makes a proposal.
- `LocationDoesNotBecomeIdentity` and `StaleLocationDoesNotChangeReference` — a location is a hint, and nothing may resolve, deduplicate or match on one.
- `EmbeddedArtifactPayloadIsRejected` — bytes are named, never carried.
- `ARowKindIsNotInferredFromData` — a "type" column is data.
- `MissingTraceabilityIsNotAFinding` — the application reports what the document declares and judges no gap.
- `ProfileIsOptional` and `AttributesRemainDomainOwned` — asserted directly rather than assumed from fixtures that happened to carry a profile.

Scenarios whose proof is a running-application check rather than a unit assertion —
the reader actually seeing a chaptered specification, following a location, meeting a
digest mismatch — are additionally exercised under §6 of `tasks.md`.
