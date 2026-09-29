## Why

[Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) is a fork of Pi with a `--mode rpc`
that speaks Pi's JSONL protocol. Pointed at it (`agentRuntime.executable: "prime-agent"`),
pi-outpost did not start: the conversation bootstrap asks for `get_tree`, falls back to OMP's
`get_branch_messages`, and Prime Agent has neither. Startup failed with
`Unknown command: get_branch_messages`.

Driving the running app against a real Prime Agent (0.9.7) then showed three more gaps:

- Prime Agent, like OMP, emits no `agent_settled`, so its `agent_end` is terminal — but it also closes
  each failed attempt, and the automatic retry (`auto_retry_start`, up to 30 attempts, delays up to
  a minute) comes after it. The composer was released while the agent kept working, and a prompt
  sent then went out as a steer into a queue nobody was shown.
- Prime Agent reports its queue as `session_action_update`, not `queue_update`.
- An abort during a retry's wait ends with `auto_retry_end` (`success: false`) and no `agent_end`.
- Its source launcher is `prime-agent.sh`, and the derived agent-directory variable became
  `PRIME_AGENT_SH_CODING_AGENT_DIR`, which it does not read: `agentDir` was silently ignored.

## What Changes

- The active-branch fallback tries `get_branch_messages` (OMP, fork command `branch`), then
  `get_fork_messages` (Prime Agent, fork command `fork`). Both answer `{ messages: [{ entryId, text }] }`.
- `session_action_update` is relayed as the queue.
- `auto_retry_start` reopens a turn an `agent_end` closed, and re-sends the child's last queue.
- `auto_retry_end` with `success: false` closes a reopened turn in the `agent_end` dialects.
- The agent-directory variable derived from the executable drops a `.sh` suffix.

## Impact

- `server/src/rpcRuntime.ts`, `server/src/piRpcProcess.ts`, `server/test/pi-rpc.test.ts`.
- README, Agent runtimes: Prime Agent named as a supported RPC agent.
