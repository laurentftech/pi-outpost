# Scenario coverage — run-prime-agent-over-rpc

Capability: `pi-rpc-runtime` (1 requirement, 5 scenarios).

Every test below runs `createRpcRuntime` against `server/test/fixtures/fake-pi-rpc.mjs`, a real
subprocess speaking LF-delimited JSONL, scripted with the answers a real Prime Agent 0.9.7 gave when
driven by hand (unknown commands answered without an `id`, `agent_end` then `auto_retry_start`,
`auto_retry_end` with `finalError: "Retry cancelled"` and no `agent_end` after an abort). Each was
checked to fail with its code path removed.

## pi-rpc-runtime

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| PrimeAgentStartsWithoutATree | covered | `server/test/pi-rpc.test.ts` — "PrimeAgentStartsWithoutATree: uses Prime Agent's fork messages and Pi's fork command". `get_tree` and `get_branch_messages` fail as unknown with no response id; asserts the runtime is ok, entries are `user-1`, `user-2`, the leaf is `user-2`, a fork sends `{ type: "fork", entryId: "user-2" }` and no `branch` command is ever sent, and a turn ends on `agent_end`. |
| NoActiveBranchSourceFailsClosed | covered | `server/test/pi-rpc.test.ts` — "NoActiveBranchSourceFailsClosed: a fork with no tree, branch or fork messages does not start". Asserts startup rejects with `Pi RPC runtime failed to start.*Unknown command: get_fork_messages`. |
| ARetryKeepsTheTurnRunning | covered | `server/test/pi-rpc.test.ts` — "ARetryKeepsTheTurnRunning: a Prime Agent retry after agent_end reopens the turn and its queue". Asserts the `session_action_update` arrives as `{ type: "queue", steering: ["queued"], followUp: ["later"] }`; that the events after `agent_end` are exactly `agent_end`, `agent_start`, `queue` with the same queue; that the snapshot is streaming; and that the next prompt is sent with `streamingBehavior: "steer"`. |
| ACancelledRetryEndsTheTurn | covered | `server/test/pi-rpc.test.ts` — "ACancelledRetryEndsTheTurn: Prime Agent sends no agent_end after a cancelled retry". Asserts the snapshot is streaming after the retry reopened the turn, then that `abort` answered by `auto_retry_end { success: false }` alone yields a second `agent_end` event and a snapshot that is not streaming. |
| ASourceLauncherReceivesTheAgentDirectory | covered | `server/test/pi-rpc.test.ts` — "ASourceLauncherReceivesTheAgentDirectory: strips the .sh of Prime Agent's prime-agent.sh". Asserts `agentDirEnv("/src/prime-agent/prime-agent.sh", "/agent")` equals exactly `{ PI_CODING_AGENT_DIR, PRIME_AGENT_CODING_AGENT_DIR }`. |

## Running app

pi-outpost from this branch was driven with Playwright against a real Prime Agent built from source
(`prime-agent.sh`), without model credentials: startup and `/health`, the model catalog, a prompt
whose attempts fail and retry (the composer stays on Stop across the retries), a prompt sent during
a retry (shown under "steering"), Stop (the turn ends), reload, new session, switching back, the
tree, and a fork from it (a new session, the composer holding the forked prompt). No page errors.
