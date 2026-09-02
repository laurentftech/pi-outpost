## Why

Work Plans can describe what an agent intends to do and whether a task is complete, but they cannot retain the verification facts behind that status. Adding structured task evidence makes successful, failed, and inconclusive checks durable and inspectable without turning the plan into a verifier or deriving completion from activity.

## What Changes

- Add zero or more generic, structured evidence records to each Work Plan task, including stable identity, evidence kind/source, verification result, a concise summary, and an optional supporting reference.
- Extend the agent-facing Work Plan operations and schema so agents can attach, replace, and remove task evidence atomically.
- Keep evidence and task status independent: neither evidence mutations nor status mutations synthesize changes in the other.
- Preserve evidence through normalization, persistence, restoration, full-plan replacement, session forks, compaction-independent reads, and authoritative Work Plan synchronization.
- Retain failed and inconclusive evidence alongside successful evidence so unsuccessful verification remains visible.
- Continue accepting existing version-1 Work Plans and creation inputs that omit evidence, defaulting missing task evidence to an empty collection.
- Keep evidence provider-neutral so tests, commands, files, tool results, external checks, OpenLore, and future integrations can all produce the same model without provider-specific fields.
- Do not add automatic verification, Outcome/Review UI, an OpenLore dependency, or inference of task completion from tool activity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-plan`: Add structured, agent-owned task evidence; evidence mutation semantics; lifecycle preservation; independence from task status; and backward compatibility for plans without evidence.
- `model`: Carry task evidence and its result through authoritative Work Plan snapshots and broadcasts without provider-specific protocol fields.

## Impact

- Shared Work Plan types, normalization, validation, limits, and mutation logic in `shared/src/workPlan.ts`, plus shared protocol exports.
- The `work_plan` tool's typed schema, descriptions, examples, and execution behavior in `server/src/workPlanTool.ts` and system guidance where needed.
- Existing sidecar persistence, session restoration/forking, compaction-independent reads, and full-snapshot synchronization must carry the expanded task model without introducing a separate evidence store.
- Unit, tool-schema/provider, real RPC, persistence/fork, and server synchronization tests must cover evidence and status independence, failed evidence retention, lifecycle propagation, atomic refusal, and legacy inputs.
- User-facing Work Plan documentation must describe evidence ownership and independence from completion; no new runtime dependency or UI surface is introduced.
