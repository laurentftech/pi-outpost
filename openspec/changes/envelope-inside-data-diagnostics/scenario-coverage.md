# Scenario coverage — envelope-inside-data-diagnostics

Capabilities: `structured-exchange` (ADDED requirement AMisplacedEnvelopeIsNamed),
`openwebui-structured-exchange` (requirement ARefusalCarriesTheContractDiagnostics),
`openwebui-structure-guide` (requirement ARefusalPointsToTheRightPage),
`openwebui-planning-server` (requirement APlanningIsAVersionThreeTimeline) and `mcp-planning-app`
(requirement ThePlanningToolsKeepTheirContract), the last four MODIFIED. Their unchanged scenarios
are re-listed because a MODIFIED requirement restates them; they keep the evidence recorded in the
archived matrices and still pass. Every new test was run against the code before this change and
failed there, then passed against it: the planning tests against the previous
`apps-core/src/planning.ts` (four failures), the contract tests against the previous
`shared/src/structuredExchangeSchemaNode.ts` with the reference validator rebuilt (four failures), the
guide test against the previous `apps-core/src/guide.ts` (one failure).

OpenLore was not available in this session (`npx openlore` is not installed); the surface was found
with `rg` over `judgePlanning`, `judgeStructure`, `checkStructuredExchangeSchema` and their callers
and tests.

## structured-exchange

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AMisplacedEnvelopeLeadsTheRefusal | covered | `server/test/structuredExchangeEnvelopeInsideData.test.ts` — "AMisplacedEnvelopeLeadsTheRefusal" (four tests). A timeline and a graph with both fields inside `data`: the first two issues deep-equal the two `envelope-inside-data` issues with their exact paths and messages, and each appears once; a timeline with only `kind` inside: the first issue is `/data/kind`, once; the rest still holds `schema/required` at the top level naming `schema, kind` and the `nodes, edges` requirement, and no further envelope issue. |
| AFieldInBothPlacesIsNotMisplaced | covered | `server/test/structuredExchangeEnvelopeInsideData.test.ts` — "AFieldInBothPlacesIsNotMisplaced: …". `misplacedEnvelopeIssues` is empty, and the refusal deep-equals the single `schema/additionalProperties` at `/data/kind`. |
| NoVerdictMoves | covered | `server/test/structuredExchangeEnvelopeInsideData.test.ts` — "NoVerdictMoves: …". Every `valid` case in `shared/conformance/index.json` is accepted with no envelope issue; every `invalid` case is refused; non-envelope inputs yield none. `server/test/structuredExchangeConformance.test.ts` still checks each case's expected rule and passes. |
| TheAgentReadsTheMisplacedEnvelopeFirst | covered | `server/test/structuredExchangeTool.test.ts` — "TheAgentReadsTheMisplacedEnvelopeFirst: …". Drives `present_structure`'s `execute`: `isError`, and the second and third lines of the text it returns (after the heading) are exactly the two `envelope-inside-data` lines; the top-level `schema, kind` reason follows. |
| TheReferenceValidatorNamesTheMisplacedEnvelope | covered | `server/test/structuredExchangeValidatorCli.test.ts` — "TheReferenceValidatorNamesTheMisplacedEnvelope: …". Runs the bundled validator from a directory outside the repository on standard input: exit 1, `valid: false`, first two issues `envelope-inside-data` at `/data/schema` and `/data/kind`. |

## openwebui-structured-exchange

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ADanglingRelationshipIsRefused | covered | `openwebui/test/structures.test.ts` — "ADanglingRelationshipIsRefused: …". Unchanged. |
| AChangeWithoutATargetIsRefused | covered | `openwebui/test/structures.test.ts` — "AChangeWithoutATargetIsRefused: …". Unchanged. |
| ADocumentTooLargeIsRefused | covered | `openwebui/test/structures.test.ts` — "ADocumentTooLargeIsRefused: …". Unchanged. |
| AMisplacedEnvelopeIsNamedFirstByShowStructure | covered | `openwebui/test/structures.test.ts` — "AMisplacedEnvelopeIsNamedFirstByShowStructure: …". Through the HTTP route: 422 (no embed page), issues deep-equal `parseSerializedStructuredExchange`'s for the same document, the first two are `envelope-inside-data` at `/data/schema` and `/data/kind`; the data directory stays empty. |

## openwebui-structure-guide

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AProposalRefusalPointsToProposals | covered | `openwebui/test/guide.test.ts` — "AProposalRefusalPointsToProposals: …". Unchanged. |
| ATableProposalPointsToRowRoles | covered | `openwebui/test/guide.test.ts` — "ATableProposalPointsToRowRoles: …". Unchanged. |
| ATimelineRefusalPointsToTimelines | covered | `openwebui/test/guide.test.ts` — "ATimelineRefusalPointsToTimelines: …". Unchanged. |
| AMisplacedEnvelopePointsToWhatTheDocumentMeant | covered | `openwebui/test/guide.test.ts` — "AMisplacedEnvelopePointsToWhatTheDocumentMeant: …". Through `show_structure`: the programme timeline with `schema`+`kind`, then `kind` alone, inside `data` → 422, first issue `envelope-inside-data`, `guide` is `timelines`; a version 2 graph → `enriched`; a version 1 graph → `graphs-and-tables`. |

## openwebui-planning-server

All tests are in `openwebui/test/plannings.test.ts` and go through the real HTTP routes of a test app.

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AValidTimelineIsCreated | covered | `openwebui/test/plannings.test.ts` — "AValidTimelineIsCreated: …". Unchanged. |
| AnInvalidTimelineIsRefusedWithDiagnostics | covered | `openwebui/test/plannings.test.ts` — "AnInvalidTimelineIsRefusedWithDiagnostics: …". Unchanged: a correct envelope still yields issues deep-equal to `parseSerializedStructuredExchange`'s. |
| AnotherKindIsRefused | covered | `openwebui/test/plannings.test.ts` — "AnotherKindIsRefused: …". Unchanged: first issue `planning-is-a-timeline`, nothing stored. |
| AMisplacedEnvelopeIsNamedWithTheRest | covered | `openwebui/test/plannings.test.ts` — "AMisplacedEnvelopeIsNamedWithTheRest: …". 422; the first two issues are `envelope-inside-data` at `/data/schema` then `/data/kind`, each saying "beside \"data\"" and quoting the form to write; the remaining issues deep-equal the contract's for the same planning with its envelope in place (the missing `end`); no message matches nodes/edges/participants/messages/columns; no file written. |
| AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid | covered | `openwebui/test/plannings.test.ts` — "AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid: …". 422 with exactly the two `envelope-inside-data` issues; no file written. |
| AWrongEnvelopeIsAnsweredWithTheEnvelopeAlone | covered | `openwebui/test/plannings.test.ts` — "AWrongEnvelopeIsAnsweredWithTheEnvelopeAlone: …". Six envelopes (kind missing, kind `graph`, schema missing, schema version 2, both missing, kind `table` inside `data`), each over data with an activity lacking an end: 422, the `planning-is-a-timeline` issues at the expected paths (`/kind`, `/schema`, `/data/kind`) with the expected wording and the envelope to write, every issue is an envelope issue (so the missing `end` and the other forms are not reported), no other-form vocabulary; no file written. |
| AComparisonIsNotAPlanning | covered | `openwebui/test/plannings.test.ts` — "AComparisonIsNotAPlanning: …". Unchanged. |
| AStoredPlanningOpensInPiOutpost | covered | `openwebui/test/plannings.test.ts` — "AStoredPlanningOpensInPiOutpost: …". Unchanged: the gate still stores the document as sent once it is accepted. |

## mcp-planning-app

All tests go through the SDK client over an in-memory transport against a real store in a
temporary folder.

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| CreateThenListThenGet | covered | `mcp/test/tools.test.ts` — "CreateThenListThenGet". Unchanged. |
| AnInvalidTimelineIsRefusedWithTheGatesDiagnostics | covered | `mcp/test/tools.test.ts` — "AnInvalidTimelineIsRefusedWithTheGatesDiagnostics". Unchanged. |
| AMisplacedEnvelopeIsNamedInTheAnswer | covered | `mcp/test/tools.test.ts` — "AMisplacedEnvelopeIsNamedInTheAnswer". `isError`; `envelope-inside-data` at `/data/schema` and `/data/kind` first, then issues deep-equal to the gate's for the planning with its envelope in place; no other-form vocabulary; the folder is empty. |
| AnUpdateIsTargetedAndRevisioned | covered | `mcp/test/tools.test.ts` — "AnUpdateIsTargetedAndRevisioned". Unchanged. |
| AFileEditedByHandIsJudgedOnRead | covered | `mcp/test/store.test.ts` — "AFileEditedByHandIsJudgedOnRead". Unchanged. |
