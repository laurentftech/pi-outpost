## 1. Shared Evidence Model

- [x] 1.1 Add failing shared-model tests for valid passed, failed, inconclusive, informational, summary-only, and reference-only evidence; invalid result/type/content; duplicate IDs; collection/field limits; and the existing 64 KiB ceiling, and verify the focused `server/test/work-plan.test.ts` run fails for the intended missing behavior.
- [x] 1.2 Add `WorkPlanEvidenceResult`/`WorkPlanEvidence` types, constants, bounds, validation, per-task ID uniqueness, and optional-input-to-empty-array normalization in `shared/src/workPlan.ts`, and verify the focused model tests from 1.1 pass while normalized plans remain version `1`.
- [x] 1.3 Add compatibility tests for legacy version-1 sidecars, `create`, `add_task`, and `replace` inputs that omit evidence, then verify each is accepted and returns canonical tasks with `evidence: []`.
- [x] 1.4 Add failing mutation tests for `set_evidence` replacement/clearing, missing arguments, invalid atomic replacement, failed-result retention, and bidirectional evidence/status independence, then implement the mutation with complete nested-state preservation and verify all shared Work Plan mutation tests pass.
- [x] 1.5 Add preservation tests for unrelated status, reason, move, dependency, resource, and task-update operations, and verify every operation leaves pre-existing successful and unsuccessful evidence byte-for-byte equivalent.

## 2. Agent Tool and Protocol Contract

- [x] 2.1 Extend shared protocol exports with the evidence/result types and verify `npm run typecheck` accepts all server and downstream Work Plan consumers without adding evidence UI behavior.
- [x] 2.2 Add failing schema tests proving complete-task and creation shapes expose bounded optional evidence, `set_evidence` exposes its typed collection, result values use one enum node, reference-only records validate, uninformative records fail, and no unconstrained/provider-specific schema reaches a provider.
- [x] 2.3 Extend `server/src/workPlanTool.ts` with reusable evidence schemas, the `set_evidence` action arguments, per-action required-field diagnostics, and complete authoritative synchronization details, then verify the focused tool-schema/refusal tests from 2.2 pass.
- [x] 2.4 Update Work Plan tool descriptions, worked guidance, and system guidance to explain complete-replacement semantics, preserving prior failures when appending, and status independence; verify prompt tests assert a literal valid evidence call and explicitly forbid automatic completion/evidence inference.
- [x] 2.5 Extend the real Pi RPC and embedded-provider fixtures to inspect and execute the evidence-capable schema, including recording both passed and failed evidence, and verify the focused RPC/provider integration tests persist the exact authoritative records.

## 3. Persistence, Fork, and Synchronization

- [x] 3.1 Extend sidecar tests to persist, reload, and delete evidence-bearing plans and to load a legacy plan without evidence; verify successful, failed, and inconclusive records survive round trips while legacy tasks normalize to empty collections.
- [x] 3.2 Extend fork tests with mixed evidence and mutate the fork after copying; verify the fork initially matches the source and later evidence replacement on either session cannot affect the other.
- [x] 3.3 Extend server synchronization tests for initial restore, post-compaction `get`, reconnect, session replacement, and multi-client `work_plan_changed` delivery; verify assertions inspect exact evidence contents and results rather than only task status/counts.
- [x] 3.4 Exercise invalid `set_evidence` through the persisted server boundary and verify the prior sidecar and every connected client's authoritative Work Plan remain unchanged.

## 4. Documentation and Verification

- [x] 4.1 Update the Work Plans section of `README.md` with the generic evidence shape, accepted results, `set_evidence` replacement semantics, persistence/fork behavior, legacy compatibility, and status independence; verify examples match the actual tool schema and document no automatic verifier or new UI.
- [x] 4.2 Enumerate every applicable main and delta `#### Scenario:` with `rg '^#### Scenario:' openspec/`, create a scenario-to-test matrix for this change, and verify every scenario is classified `covered` with the exact test file/name and assertions at the boundary described by the scenario.
- [x] 4.3 Run the focused Work Plan unit, tool, persistence, provider, and server tests first, then `npm run test --workspace server` and `npm run typecheck`; verify all commands pass without weakening evidence, failure-retention, atomicity, or independence assertions.
- [x] 4.4 Run strict OpenSpec validation for `work-plan-evidence-and-verification` and verify the proposal capability, complete modified requirement blocks, scenario formatting, design decisions, and checkbox task syntax all pass.
- [x] 4.5 Start the real application and use Playwright to ask the actual agent to create a task, record both successful and unsuccessful evidence, change status separately, and read the plan back; verify the DOM, session transcript/tool result, and persisted sidecar agree and no status was inferred.
- [x] 4.6 Perform an adversarial Playwright pass with rapid evidence/status mutations plus session switch/fork/reconnect transitions; after each burst read the DOM and persisted/session state and verify there is no stale, lost, cross-session, or fabricated evidence and no stuck UI state.
- [x] 4.7 Inspect the final diff for documentation impact, run `git diff HEAD`, invoke the required code-reviewer with the task context and full diff, address all CRITICAL/HIGH findings, and verify the final review verdict plus any remaining MEDIUM/LOW findings is recorded before completion.
