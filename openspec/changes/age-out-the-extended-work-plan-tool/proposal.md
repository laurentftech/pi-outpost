# Age out the extended Work Plan tool

## Why

`work_plan_extended` is published the moment a session has a plan, and then never
withdrawn while that plan exists. Its schema is the largest of the pair — dependency
sets, resource sets, evidence collections and whole-plan replacement — and it rides
in **every** request for the rest of the conversation, most of them nowhere near a
dependency or a piece of evidence.

Measured on a real session's compaction checkpoint: 3 603 bytes for
`work_plan_extended` and 3 442 for `work_plan`, 7 045 of the 70 374 bytes that 68 tool
declarations cost that session — and the checkpoint as a whole was half of everything
sent to the model before a word of new work. On a local model with a 128k window that
is not rounding error.

The machinery to fix it is already in this file. Document extractors are published on
demand and forgotten after a measured silence (`DOCUMENT_TOOL_IDLE_LIMIT`). The
extended Work Plan tool was left out of it, and the comment above the extractors'
threshold says why the caution was right for *them*: "an agent cannot ask for a tool it
can no longer see", so naming the document again is the only way back, and that is the
user's to take.

That objection does not hold here. `work_plan` is never withheld, its description names
the extended half, and any successful call to either republishes the pair from inside
the turn. The way back is the agent's own.

## What Changes

- `work_plan_extended` enrols in the same idle count as the extractors when it is
  published, and is withdrawn after five turns in which nothing touched the plan.
- Five from the start, never the extractors' `unused: 1`. That threshold pays back a
  *guess* — a document named in passing that turned out not to matter. There is no
  guess here: the tool is published because a plan exists, which the sidecar states.
- Any successful `work_plan` or `work_plan_extended` call resets the count, and a call
  made after a withdrawal republishes the tool from inside the turn — so the very next
  request carries it again.
- `withholdDocumentTools` now runs *before* `publishWorkPlanTools` at the three sites
  that call both. It clears the idle counts, and the work plan tool now enrols in them.

## Impact

- Affected specs: `work-plan` (one added requirement).
- Affected code: `server/src/index.ts`.
- Unchanged: the RPC dialect still publishes both tools at all times, since it cannot
  change its active toolset. Nothing about the persisted plan, the schemas, or which
  action belongs to which tool moves.
