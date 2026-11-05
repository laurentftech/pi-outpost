# Scenario coverage

| Scenario | Status | Test and assertions |
| --- | --- | --- |
| ShortChoicesFollowAvailablePanelWidth | covered | `e2e/extension-questions.spec.ts`, "brief choices use two columns only when the panel has room, including after resize": actual element positions/widths on a wide viewport, with sidebar open, sidebar closed and mobile. The successive-question test resizes checked boxes and verifies the chosen value survives. |
| LongChoiceDescriptionsStayStacked | covered | `e2e/extension-questions.spec.ts`, "long descriptions stay in one column for buttons and checkboxes on a wide screen": actual vertical positions and values received by the real extension. |
| LongSandboxRequestsKeepContextAndDecisionsVisible | covered | `e2e/sandbox-question-context.spec.ts`, both "long sandbox request" tests: real provider, broker and server; exact command/reason/all paths, timeline interaction, mobile bounds/no overflow, independent detail scrolling, visible decisions, no execution before an answer, real refusal/once outcomes and execution marker. |
| AnApprovedCommandRuns (sandbox main spec) | covered | `e2e/sandbox-question-context.spec.ts`, "long sandbox request: Allow once stays explicit while details and timeline scroll": explicit click, approved-once resolution and command execution marker; `server/test/sandboxGrantsServer.test.mjs` also verifies the once grant does not survive its command. |
| ARefusedRequestRunsNothing (sandbox main spec) | covered | `e2e/sandbox-question-context.spec.ts`, "long sandbox request: Refuse stays explicit while details and timeline scroll": refused resolution, error tool result and no command marker. |
| NoAnswerIsARefusal (sandbox main spec) | covered | `server/test/sandboxGrantBroker.test.ts`, "NoAnswerIsARefusal: unanswered in time it expires, aborted it is aborted; the dialog closes either way": expiry/abort settle the request and announce closure. `ui/src/useAgent.test.ts`, "holds a grant request until the server resolves it, whoever answered; the session's grants follow": closure follows the authoritative server resolution. |
| NobodyToAskIsARefusal (sandbox main spec) | covered | `server/test/sandboxGrantBroker.test.ts`, "NobodyToAskIsARefusal: with no client connected, refused at once and never shown": unattended requests refuse without a prompt. |
| TheFirstAnswerWins (sandbox main spec) | covered | `server/test/sandboxGrantBroker.test.ts`, "TheFirstAnswerWins: the first answer decides, a later one is ignored, every client is told": one resolution broadcast, later and unknown responses ignored; `ui/src/useAgent.test.ts` keeps the question until that resolution. |

The existing context, draft, request-order and cancellation scenarios in
`openspec/changes/readable-extension-questions/scenario-coverage.md` still run in the same browser suite.
`ui/src/components/SandboxGrantDialog.test.tsx` covers command/connection wording, targets/access modes,
read-only override warnings, every decision, duplicate clicks, pending server acknowledgement and new requests.
Existing `server/test/sandboxGrantsServer.test.mjs` and `server/test/sandboxGrantBroker.test.ts` cover
approval/refusal, first-answer wins, expiry/abort, unattended requests and grant lifetimes.
