## Why

`work_plan`'s schema is sent to the provider on every request of every conversation,
whether or not a plan is ever made. Measured 2026-09-03, after the trimming in #162:
**12 480 characters, ~3.1k tokens**, against a whole default baseline of ~9.8k. A
conversation that never opens a plan pays a third of its floor for a capability it does
not use, on every turn. opencode's comparable `todowrite` is 2 686 characters.

The cost is not spread evenly across what the tool does. Four of its eleven actions carry
almost all of it — `replace` serialises a complete normalized plan, and `set_evidence`,
`set_resources` and `set_dependencies` carry collections whose shapes are also inlined
into every creation task. They are also the four an agent reaches for least: a plan is
opened, tasks are added, statuses move on. Evidence and dependency edits come later, if at
all.

## What Changes

Split the capability in two, and publish the second only when it can be used.

- **`work_plan`** — the common path: `get`, `create`, `add_task`, `update_task`,
  `move_task`, `remove_task`, `clear`. Creation tasks carry title, description, status,
  reason and subtasks. **3 071 characters** of schema, measured on the partition.
- **`work_plan_extended`** — the rest: `replace`, `set_dependencies`, `set_resources`,
  `set_evidence`, and the collection shapes they need. **5 894 characters**, published
  only to a session that has a plan, since every one of its operations acts on tasks that
  must already exist.
- Evidence and resources leave the creation shape **and the added-task shape**. They are
  set on a task that exists, through the extended tool, where their shapes already live.
  The persisted representation is unchanged — a draft carrying them still normalises —
  but the schema is authoritative for an agent: pi validates a call against it before the
  handler runs, so this is a narrowing, not a hint.

Both funnel into `mutateWorkPlan` unchanged: the split is in what is published, not in
what is validated or stored.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `work-plan`: what a session publishes becomes two tools rather than one, and the second
  is a function of whether the session has a plan. `Self-describing Work Plan tool
  contract` is amended to say what each publishes; a new requirement covers the split and
  the transition.

## Impact

- **Server** — `server/src/workPlanTool.ts` (two definitions over one action partition),
  `server/src/index.ts` (register both), `server/src/embeddedRuntime.ts` (activate the
  extended tool from the persisted plan's existence).
- **Prompt** — `server/src/systemPrompt.ts`: the guidance for evidence follows the tool
  that carries it.
- **No wire change, no client change.**
- **Measured** — `work_plan` alone is 5 003 characters (~1.3k tokens) against 12 480
  before; both together 10 404 (~2.6k), still below. The whole resting baseline goes
  from ~9.8k tokens to **~7.8k**, read from
  `server/scripts/probe-context-baseline.mts`.

## What this does not do

- **RPC.** That dialect has no command for the active toolset, so an RPC child publishes
  both tools at all times. Stated rather than emulated: the embedded SDK runtime is the
  supported target.
- **`$defs`/`$ref`.** The resource shape still appears in both tools and the evidence
  record five times inside the extended one. Factoring them is worth another ~4k
  characters and needs checking against a constrained-decoding gateway first — separate
  change.
