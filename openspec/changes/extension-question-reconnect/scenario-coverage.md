# Scenario coverage

| Scenario | Status | Test and assertions |
| --- | --- | --- |
| AnUnansweredQuestionSurvivesBrowserReconnection | covered | `e2e/extension-questions.spec.ts`, "an unanswered question survives losing the last browser connection and an outside click on return": real app and extension, no hidden test socket, reload/reconnection, question remains, outside timeline click sends no refusal, original choice received. Failed before the fix with "Selected: cancelled". `server/test/extensionQuestionReconnect.test.mjs` also verifies original request IDs and absence of cancellation for embedded and RPC runtimes. |
| AWaitingProjectOutlivesItsIdleTimeout | covered | `server/test/extensionQuestionReconnect.test.mjs`, both runtime tests: a non-default workspace, no connected clients, three idle sweeps, unchanged session/request ID, then successful original answer. |
| DeliberateSessionReplacementCanAbandonAQuestion | covered | `server/test/extensionQuestionReconnect.test.mjs`, both runtime tests: ask again, explicitly start a new session, receive its snapshot, observe cancellation of the abandoned request and accept a thinking-level command afterwards. |

Existing context/cancellation contracts remain covered by `e2e/extension-questions.spec.ts` and
`ui/src/components/ExtensionDialog.test.tsx`. Explicit expiry and abort remain covered by
`server/test/extensionUiBridge.test.ts` ("dialog timeout and abort"). Workspace switching,
background questions and normal retirement remain covered by
`server/test/multiProjectWorkspaces.test.mjs` and `server/test/multiProjectLifecycle.test.mjs`.
