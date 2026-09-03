## Why

`work_plan`'s schema is sent to the provider on every turn of every conversation,
whether or not a plan is ever made. Measured on 2026-09-03: **12 480 characters, ~3.1k
tokens** — after the 4k-token version was trimmed — against a whole default baseline of
~9.8k. A conversation that never opens a plan pays about a third of its floor for a
capability it does not use, on every single turn.

Most conversations never open one. The tool's own guidance says so: "trivial exchanges
need no plan."

The pi SDK can already stop paying for it. `AgentSession.setActiveToolsByName()` changes
the active toolset and, in the SDK's words, "rebuilds the system prompt to reflect the new
tool set" — a tool that is not active is not described. What it cannot do is register a
definition after the session exists, so the resting state cannot simply be a smaller
`work_plan`: both definitions have to be registered up front, and one of them made active.

## What Changes

- A session with no Work Plan offers a **small opener** instead of the full contract: one
  tool, no operations to enumerate, whose only job is to say that this work needs a plan.
- Calling it activates the full `work_plan` contract for that session, available to the
  very next call — the agent opens the plan in the same turn it decided to.
- A session that **already has a plan** — restored, resumed, forked — starts with the full
  contract active. Nothing is discovered twice.
- `clear` returns the session to the resting state, and so does starting a new session.
- The RPC runtime keeps the full contract at all times: its dialect has no command for
  changing the active toolset. This is stated rather than worked around — the embedded SDK
  runtime is the supported target and `rpc` is best effort.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `work-plan`: the tool contract a session publishes becomes a function of whether that
  session has a plan. `Self-describing Work Plan tool contract` is amended to say what is
  published in each state, and a new requirement covers the transition between them.

## Impact

- **Server** — `server/src/workPlanTool.ts` (the opener definition), `server/src/index.ts`
  (register both, choose the initially active one), `server/src/embeddedRuntime.ts` (flip
  on `applyWorkPlanMutation` and on session restore).
- **Prompt** — `server/src/systemPrompt.ts`: the resting guidance is one sentence, not the
  work-plan guidance block, which follows the full contract.
- **No wire change, no client change.** The interface already renders whatever plan exists.
- **Expected saving** — ~3k tokens per turn on any conversation that never opens a plan,
  taking the default baseline from ~9.8k to ~7k.
