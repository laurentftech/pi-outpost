# Scenario coverage — planning-envelope-diagnostics

Capabilities: `openwebui-planning-server` (requirement APlanningIsAVersionThreeTimeline) and
`mcp-planning-app` (requirement ThePlanningToolsKeepTheirContract), both MODIFIED. Their unchanged
scenarios are re-listed because a MODIFIED requirement restates them; they keep the evidence recorded
in the archived `openwebui-planning-tool-server` and `mcp-planning-app` matrices and still pass. Each
new test was run against the previous `apps-core/src/planning.ts` and failed there (four failures),
then passed against this change.

OpenLore was not available in this session (`npx openlore` is not installed); the surface was found
with `rg` over `judgePlanning`, its callers (`openwebui/src/store.ts`, `mcp/src/store.ts`) and their
tests.

## openwebui-planning-server

All tests are in `openwebui/test/plannings.test.ts` and go through the real HTTP routes of a test app.

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AValidTimelineIsCreated | covered | `openwebui/test/plannings.test.ts` — "AValidTimelineIsCreated: …". Unchanged. |
| AnInvalidTimelineIsRefusedWithDiagnostics | covered | `openwebui/test/plannings.test.ts` — "AnInvalidTimelineIsRefusedWithDiagnostics: …". Unchanged: a correct envelope still yields issues deep-equal to `parseSerializedStructuredExchange`'s. |
| AnotherKindIsRefused | covered | `openwebui/test/plannings.test.ts` — "AnotherKindIsRefused: …". Unchanged: first issue `planning-is-a-timeline`, nothing stored. |
| AMisplacedEnvelopeIsNamedWithTheRest | covered | `openwebui/test/plannings.test.ts` — "AMisplacedEnvelopeIsNamedWithTheRest: …". 422; the first two issues are `planning-envelope` at `/data/schema` then `/data/kind`, each saying "beside \"data\"" and quoting the form to write; the remaining issues deep-equal the contract's for the same planning with its envelope in place (the missing `end`); no message matches nodes/edges/participants/messages/columns; no file written. |
| AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid | covered | `openwebui/test/plannings.test.ts` — "AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid: …". 422 with exactly the two `planning-envelope` issues; no file written. |
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
| AMisplacedEnvelopeIsNamedInTheAnswer | covered | `mcp/test/tools.test.ts` — "AMisplacedEnvelopeIsNamedInTheAnswer". `isError`; `planning-envelope` at `/data/schema` and `/data/kind` first, then issues deep-equal to the gate's for the planning with its envelope in place; no other-form vocabulary; the folder is empty. |
| AnUpdateIsTargetedAndRevisioned | covered | `mcp/test/tools.test.ts` — "AnUpdateIsTargetedAndRevisioned". Unchanged. |
| AFileEditedByHandIsJudgedOnRead | covered | `mcp/test/store.test.ts` — "AFileEditedByHandIsJudgedOnRead". Unchanged. |
