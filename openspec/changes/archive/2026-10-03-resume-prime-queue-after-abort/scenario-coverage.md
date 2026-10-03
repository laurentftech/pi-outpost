# Scenario coverage — resume-prime-queue-after-abort

Capability: `pi-rpc-runtime` (1 modified requirement, 7 scenarios). The five scenarios carried over
unchanged from the archived `run-prime-agent-over-rpc` keep the tests that change cites.

The new tests run `createRpcRuntime` against `server/test/fixtures/fake-pi-rpc.mjs`, a real
subprocess speaking LF-delimited JSONL. With `suspendsQueueOnAbort`, it refuses a plain `prompt`
after `abort` with Prime Agent 0.9.7's exact message until a `prompt` carries `streamingBehavior`,
which is what the real agent did when driven by hand.

## pi-rpc-runtime

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| PrimeAgentStartsWithoutATree | covered | `server/test/pi-rpc.test.ts` — "PrimeAgentStartsWithoutATree: uses Prime Agent's fork messages and Pi's fork command". Unchanged by this change. |
| NoActiveBranchSourceFailsClosed | covered | `server/test/pi-rpc.test.ts` — "NoActiveBranchSourceFailsClosed: a fork with no tree, branch or fork messages does not start". Unchanged by this change. |
| ARetryKeepsTheTurnRunning | covered | `server/test/pi-rpc.test.ts` — "ARetryKeepsTheTurnRunning: a Prime Agent retry after agent_end reopens the turn and its queue". Unchanged by this change. |
| ACancelledRetryEndsTheTurn | covered | `server/test/pi-rpc.test.ts` — "ACancelledRetryEndsTheTurn: Prime Agent sends no agent_end after a cancelled retry". Unchanged by this change. |
| APromptAfterAnAbortResumesThePrimeQueue | covered | `server/test/pi-rpc.test.ts` — "APromptAfterAnAbortResumesThePrimeQueue: a prompt refused as suspended is resent once with streamingBehavior". Asserts `onAccepted` reports only `true`; exactly two `prompt` commands, the first without `streamingBehavior` and the second with `"followUp"` and the same message; the turn ends; and the next prompt goes out without `streamingBehavior`. Fails with the resend removed (the refusal reaches the caller). |
| OnlyTheSuspendedRefusalIsResent | covered | `server/test/pi-rpc.test.ts` — "OnlyTheSuspendedRefusalIsResent: any other refused prompt is reported, not retried". Asserts the prompt rejects with `No model selected`, `onAccepted` reports `[false]`, and exactly one `prompt` command was sent. |
| ASourceLauncherReceivesTheAgentDirectory | covered | `server/test/pi-rpc.test.ts` — "ASourceLauncherReceivesTheAgentDirectory: strips the .sh of Prime Agent's prime-agent.sh". Unchanged by this change. |

## Running app

The packed build of this branch was run with a real Prime Agent 0.9.7 and driven with Playwright: a
message asking for an `ipython` call that sleeps 30 s, Stop while the tool card was showing, then
"Reply with just: OK after stop", which the agent answered ("OK"). Prime Agent's command journal
shows `prompt ✓, abort ✓, prompt ✗ (queued session input is suspended), prompt ✓`: the refusal
happened and the resend lifted it.
