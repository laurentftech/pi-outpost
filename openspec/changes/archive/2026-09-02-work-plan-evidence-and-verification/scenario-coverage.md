# Scenario-to-test matrix

Scenarios were enumerated with `rg '^#### Scenario:' openspec/specs/{work-plan,model}/spec.md openspec/changes/work-plan-evidence-and-verification/specs/{work-plan,model}/spec.md`. “Covered” means the cited assertions exercise the observable boundary, not merely the test title. The running-app checks used the real web application and provider boundary, then compared the DOM, tool-result transcript, and persisted sidecars.

## Applicable main Work Plan scenarios

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| Progressive decomposition | covered | `server/test/work-plan.test.ts` — “progressively decomposes a task without changing its identity” asserts the stable parent identity and inserted child relationship. |
| Blocked work is explained | covered | `ui/src/components/WorkPlanPanel.test.tsx` — “shows hierarchy, distinct states, focus, and aggregate progress” inspects the blocked state and reason. |
| Atomic task update | covered | `server/test/work-plan.test.ts` — “rejects invalid hierarchy and dependency cycles without changing the input” and “returns authoritative details and refuses a partial invalid mutation” compare the pre/post state. |
| Activity does not complete work | covered | `server/test/work-plan-server.test.mjs` — “running server restores, forks, reconnects, and broadcasts authoritative Work Plans” performs an unrelated read and asserts status remains unchanged. |
| Reconcile before completion | covered | Prompt composition is asserted by `server/test/work-plan.test.ts` — “ships valid evidence guidance with explicit replacement and status independence”. In the running app, the actual provider recorded passed and failed evidence while the task was still `todo`, changed status in a separate call, then issued `get`; DOM, expanded tool result, transcript, and sidecar agreed. |
| Resume interrupted work | covered | `server/test/work-plan-server.test.mjs` — initial and reconnect snapshots compare the restored authoritative plan. |
| Compaction preserves the plan | covered | `server/test/work-plan-server.test.mjs` rewrites the transcript, then compares the separate sidecar and reconnect snapshot. |
| Agent reads the plan after compaction | covered | `server/test/work-plan-server.test.mjs` requires a post-compaction `get` and asserts the returned authoritative evidence-bearing plan. |
| Readable overview | covered | `ui/src/components/WorkPlanPanel.test.tsx` — “shows hierarchy, distinct states, focus, and aggregate progress” asserts the user-visible summary boundary. |
| Preview a collapsed plan | covered | `ui/src/components/WorkPlanPanel.test.tsx` — “previews task lines from the collapsed progress control before opening details”; `e2e/work-plan.spec.ts` exercises the collapsed control. |
| Navigate a resource | covered | `ui/src/components/WorkPlanPanel.test.tsx` — resource navigation and safety tests; `e2e/work-plan.spec.ts` opens a real workspace resource. |
| Creation schema declares its complete input | covered | `server/test/work-plan.test.ts` — “publishes a bounded action-specific schema with no unconstrained payload” recursively checks the serialized creation schema. |
| Mutation branches require their own arguments | covered | The same schema test asserts each branch’s action-specific `required` array. |
| A refusal names the field it refuses | covered | `server/test/work-plan.test.ts` — “refuses an action whose own argument is missing, by name” and “answers a refused property by naming it”. |
| Clearing optional values is discoverable | covered | `server/test/work-plan.test.ts` — “clears optional task text through JSON null” and the serialized schema assertions. |
| The tool carries a worked example | covered | `server/test/work-plan.test.ts` — “ships a worked example the model can copy” and “ships valid evidence guidance…” validate literal calls against the contract. |
| Create a minimal plan | covered | `server/test/work-plan.test.ts` — “normalizes a minimal creation draft into a canonical version-1 plan” checks exact defaults. |
| Create direct subtasks | covered | `server/test/work-plan.test.ts` — “preserves explicit fields and flattens tasks plus one subtask level” checks parent wiring. |
| A plan is created with its dependencies | covered | `server/test/work-plan.test.ts` — “creates a plan that already carries its dependencies” checks canonical IDs. |
| A dependency may name a task declared later | covered | `server/test/work-plan.test.ts` — “resolves a dependency on a task declared further down”. |
| An unresolvable dependency is refused by name | covered | `server/test/work-plan.test.ts` — “names the dependency it cannot resolve” checks the diagnostic and atomic refusal. |
| The agent names its own tasks | covered | `server/test/work-plan.test.ts` — “honours a task id the agent supplies and generates the rest”. |
| Duplicate supplied identity is rejected atomically | covered | `server/test/work-plan.test.ts` — “rejects a duplicate supplied id without persisting anything”. |
| Creation limits are discoverable and atomic | covered | `server/test/work-plan.test.ts` — bounded schema plus depth, count, generated-ID, serialized-size, and no-sidecar assertions. |
| Explicit task fields survive normalization | covered | `server/test/work-plan.test.ts` — “preserves explicit fields…” compares status, text, resources, and hierarchy. |
| Persistence mechanics stay out of the creation input | covered | `server/test/work-plan.test.ts` — “rejects persistence fields in the ergonomic draft” and serialized schema inspection. |
| Creation returns usable task identities | covered | `server/test/work-plan.test.ts` — “creates once from a compact hierarchy and returns the bounded authoritative plan”. |
| Creation does not overwrite an existing plan | covered | The same tool test attempts a second create and compares the stored plan unchanged. |
| Invalid nested creation is atomic | covered | `server/test/work-plan.test.ts` — “does not create a sidecar when any nested creation task is invalid”. |
| Existing task addition remains accepted | covered | `server/test/work-plan.test.ts` — legacy compatibility test; real RPC and embedded-provider tests execute `add_task`. |
| Duplicate task identity is rejected atomically | covered | `server/test/work-plan.test.ts` — “rejects a duplicate add_task identity without changing the plan”. |
| Existing full replacement remains accepted | covered | `server/test/work-plan.test.ts` — “keeps normalized version-1 replacement compatible”. |
| Typed update preserves unspecified fields | covered | `server/test/work-plan.test.ts` — “keeps every unspecified field in a typed partial update”. |
| An operation that names a task refuses to run without one | covered | `server/test/work-plan.test.ts` — “refuses an action whose own argument is missing, by name”. |
| A payload-carrying operation refuses to run empty | covered | The same test covers empty add, replace, dependency, resource, and evidence payloads. |
| An update that changes nothing is refused | covered | `server/test/work-plan.test.ts` tool-validation assertions reject a task-only update. |
| Changed fields are accepted beside the task identifier | covered | `server/test/work-plan.test.ts` — “accepts changed fields beside the task identifier”. |
| An explicit changes object still wins | covered | The same test asserts the nested `changes` values take precedence. |
| Identity cannot be changed through either shape | covered | `server/test/work-plan.test.ts` — “refuses task identity supplied at either level of an update”. |

## Delta evidence scenarios

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| Attach successful verification | covered | `server/test/work-plan.test.ts` — “preserves generic successful, unsuccessful, and supporting evidence” compares the passed record exactly. |
| Retain unsuccessful verification | covered | The same test compares failed and inconclusive records; mutation/persistence tests retain them through later operations. |
| Reference supporting information | covered | The same test accepts a reference-only generic URI/label and the schema test validates that shape. |
| Reject an uninformative evidence record atomically | covered | `server/test/work-plan.test.ts` — “rejects invalid or duplicate evidence atomically” compares the input plan after refusal. |
| Reject duplicate evidence identity atomically | covered | The same test rejects duplicate per-task IDs without mutation. |
| Passing evidence does not complete a task | covered | `server/test/work-plan.test.ts` — “replaces and clears evidence without inferring task status”. |
| Failed evidence does not block a task automatically | covered | The same test records failed evidence on a done task and asserts status remains done. |
| Completion does not fabricate evidence | covered | The same test updates status independently and asserts `evidence: []`; unrelated-mutation preservation covers existing evidence. |
| Status edits preserve recorded failures | covered | `server/test/work-plan.test.ts` — “preserves evidence through every unrelated task mutation” deep-compares failed evidence. |
| Create a task with evidence | covered | `server/test/work-plan.test.ts` — successful/unsuccessful/supporting evidence normalization; RPC/provider integration persists exact records. |
| Create a task without evidence | covered | `server/test/work-plan.test.ts` — minimal creation and legacy compatibility assert canonical `evidence: []`. |
| Restore a legacy version-1 plan | covered | `server/test/work-plan.test.ts` — “loads a legacy version-1 sidecar with empty canonical evidence”. |
| Evidence limits are discoverable and atomic | covered | `server/test/work-plan.test.ts` — “enforces evidence collection and field limits before the whole-plan limit” plus finite schema checks. |
| Replace a task's evidence | covered | `server/test/work-plan.test.ts` — “replaces and clears evidence without inferring task status” asserts complete replacement. |
| Remove all task evidence | covered | The same test passes `[]` and asserts the collection is empty while status is unchanged. |
| Missing evidence arguments are refused by name | covered | `server/test/work-plan.test.ts` — “refuses missing or invalid evidence replacements…” asserts `taskId`/`evidence` diagnostics. |
| Invalid replacement does not discard prior evidence | covered | The same test and the persisted-server test compare exact prior evidence and raw sidecar after refusal. |
| Progressive decomposition | covered | `server/test/work-plan.test.ts` — decomposition identity test plus “preserves evidence through every unrelated task mutation”. |
| Blocked work is explained | covered | UI blocked-reason assertion remains unchanged; evidence mutation test separately proves failed evidence does not infer blocked status. |
| Tasks may have no evidence | covered | Minimal and legacy normalization tests assert an empty canonical collection. |
| Atomic task update | covered | Shared and persisted-server invalid replacement tests compare plan, sidecar, and broadcast state unchanged. |
| Activity does not complete work | covered | Running-server unrelated-read assertion keeps task status unchanged while exact evidence is retained. |
| Reconcile before completion | covered | Guidance tests require explicit passed/failed/inconclusive recording. The running-app agent issued `set_evidence` with exact passed and failed records, then a separate `update_task`, then `get`; the intermediate transcript proves evidence did not infer status. |
| Activity does not fabricate evidence | covered | `server/test/work-plan-server.test.mjs` performs unrelated activity and asserts no evidence or status mutation is broadcast or persisted. |
| Resume interrupted work | covered | Persistence and reconnect assertions compare exact successful, failed, and inconclusive records. |
| Fork preserves independent evidence | covered | `server/test/work-plan.test.ts` mutates source and fork both ways after copying; running-server test checks source isolation. |
| Existing task addition remains accepted | covered | Legacy compatibility and real provider-boundary sequences execute evidence-free `add_task`. |
| Duplicate task identity is rejected atomically | covered | Duplicate add test compares evidence-bearing input unchanged. |
| Existing full replacement remains accepted | covered | Legacy version-1 replacement normalizes missing evidence; evidence-bearing normalized plans round-trip exactly. |
| Typed update preserves unspecified fields | covered | Partial-update and unrelated-mutation tests deep-compare nested evidence. |
| Evidence synchronizes as authoritative task state | covered | Server initial restore, compaction, reconnect, replacement, and multi-client assertions compare exact evidence. In the running app, two rapid mutation sequences produced distinct plan/task IDs; rapid switches exposed only the selected session’s ID, a fork copied exact evidence, reload restored it, all three sidecars matched their expected source, and browser error/warning logs were empty. |

## Delta model protocol scenarios

The delta contains the complete modified `Work Plan protocol state` requirement, so these rows also account for its applicable main-spec scenarios.

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| Snapshot supplies Work Plan | covered | `server/test/work-plan-server.test.mjs` — “running server restores, forks, reconnects, and broadcasts authoritative Work Plans” compares exact passed and failed records in initial, replacement, fork, and reconnect snapshots. |
| Change reaches all clients | covered | The same running-server test waits for both connected clients’ `work_plan_changed` frames and deep-compares the exact authoritative evidence-bearing plan. |

## Final verification record

- Focused Work Plan contract/tool/persistence tests: 45 passed.
- Focused running-server, real Pi RPC, and embedded-provider integrations: 3 passed.
- Full server suite: 1,761 passed.
- Root workspace typecheck: passed.
- Strict OpenSpec validation: passed.
- Running-app Playwright happy and adversarial passes: DOM, transcript/tool results, sidecars, session switch, fork, and reconnect agreed; browser warning/error log was empty.
- Required code review after corrections: **APPROVED**, with 0 CRITICAL, HIGH, MEDIUM, or LOW findings remaining.
