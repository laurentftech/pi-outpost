## Why

Prime Agent 0.9.7 suspends its queued session input when an abort lands during a tool call. In RPC
mode a `prompt` only lifts that suspension when it carries `streamingBehavior`: the daemon derives
"resume if idle" from the field's presence, not its value. Its `resume_queue` command is not
reachable over RPC (`Unknown command: resume_queue`).

So after Stop during an `ipython` call, pi-outpost's next message was refused with
`Cannot admit a session action while queued session input is suspended.`, and so was every message
after it. The only way out was a new session, losing the conversation.

This is an upstream bug, reported as
[prime-agent discussion #3163](https://github.com/PrimeIntellect-ai/prime-agent/discussions/3163)
(related: their closed #1646). This change works around it until Prime fixes it.

## What Changes

- A `prompt` refused with exactly that message is resent once with `streamingBehavior: "followUp"`.
  Any other refusal is reported unchanged. Remove the workaround once Prime Agent resumes on a plain
  RPC `prompt`.
- If Prime changes the gate so the resend no longer helps, the user sees the same error as before.

## Impact

- `server/src/rpcRuntime.ts`, `server/test/fixtures/fake-pi-rpc.mjs`, `server/test/pi-rpc.test.ts`.
- No documentation impact: the behaviour was never documented, and the workaround is invisible when it works.
