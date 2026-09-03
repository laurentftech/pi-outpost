# Scenario coverage

All 14 `#### Scenario:` entries in `specs/work-plan/spec.md`, enumerated with
`rg '^#### Scenario:' openspec/changes/offer-the-work-plan-contract-only-once-it-is-used/`.
`Self-describing Work Plan tool contract` is MODIFIED, so its five scenarios are reproduced;
one of them is untouched by the split and its existing test still proves it.

Test files:

- `server/test/work-plan.test.ts` (`unit`) — the published definitions and the runtime method
- `server/test/work-plan-server.test.mjs` (`wire`) — a real server, a real provider inside a real embedded session, and a real `pi --mode rpc` child
- `server/test/fixtures/work-plan-rpc-provider.mjs` (`provider`) — the assertions that run *inside* the model provider, on the tools it was actually sent

## work-plan — Self-describing Work Plan tool contract (MODIFIED)

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| Creation schema declares its complete input | covered | `unit`: "publishes bounded action-specific schemas, in both tools…" | Walks both schemas for empty nodes, asserts the creation shape declares title, status, subtasks and `dependsOn` at both depths, and that no node is an unconstrained `{}`. A collection quietly re-added to creation fails the two `assert.equal(taskProperties.evidence, undefined)` lines. |
| Mutation branches require their own arguments | covered | `unit`: same test | Every operation-specific property must name its action in its description, checked per tool — `plan` names `replace` in the extended schema, `tasks` names `create` in the common one. A property moved between tools without its description fails. |
| A refusal names the field it refuses | covered | `unit`: "answers a refused property by naming it, and says nothing about other actions" | Unchanged by this split, and still asserted: a call carrying a property its action does not accept is answered with that property's name and path, and with nothing about the operations it did not request. |
| Clearing optional values is discoverable | covered | `unit`: same first test | `description`, `statusReason` and `parentId` must still declare their `null` branch — now read from the common tool's flat properties, where `update_task` takes them. |
| The tool carries a worked example | covered | `unit`: "ships a worked example the model can copy" | The creation example is parsed out of the guidelines and run through `normalizeWorkPlanDraft`: it must still produce one dependency and one subtask. An example that no longer matches the narrowed creation shape fails there rather than in a model's face. |

## work-plan — The Work Plan contract is split by what an operation needs (ADDED)

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| A session with no plan publishes only the common operations | covered | `wire` + `provider`: "the embedded SDK provider receives the same fully typed work_plan schema" | The provider runs inside the real session and throws `work_plan_extended reached a provider before any plan existed` if the tool is sent on the first request. The gating is asserted where it matters — in the payload the model receives — not in a snapshot field. |
| Creating a plan publishes the rest within the same turn | covered | `wire` + `provider`: same test | After the first `create`, every later request must carry the extended tool (`expectExtended`), and the scripted turn then calls `set_evidence` **on `work_plan_extended` in that same turn**. Publishing from the queued sidecar reload instead of the tool result fails this exactly as it did during development. |
| A session that already has a plan publishes both | covered | `unit`: "adds the extended tool to the active set and takes nothing else out" | `EmbeddedRuntime.setToolPublished` is what every bind path calls (`publishWorkPlanTools` at boot, at project start, and on session replacement). The test drives the real method and asserts the resulting active set. |
| Clearing a plan withdraws the extended operations | covered | `unit`: "withdraws it again when the plan is cleared, leaving the common tool published" | The same method with `published: false` must remove that name and leave `work_plan` and everything else in place. |
| Every action belongs to exactly one tool | covered | `unit`: "gives every action exactly one home…" | Built from `WORK_PLAN_ACTIONS` rather than a hand-written list: an action added to the shared enum and to neither tool, or to both, fails the `carriers.length === 1` assertion. |
| An action asked of the wrong tool is refused | covered | `unit`: "gives every action exactly one home, and each tool says where the others live" — `server/test/work-plan.test.ts` | The published schema is compiled and asked to validate `set_evidence` against `work_plan`: it must refuse, and the extended tool's schema must accept the same call. This replaces an earlier assertion that drove `execute` directly and claimed a named refusal — a path no model reaches, since the runtime validates before the tool runs. Codex caught the overstatement; a wire probe confirmed a real model gets `action: must be equal to one of the allowed values`. |
| Each tool says where the other operations live | covered | `unit`: same test | Each tool's description and guidelines must name the other. This is what keeps a model out of the refusal above, and it is the only part of "says where it lives" that reaches a model before it calls. |
| Creation no longer advertises evidence, and the store still accepts it | covered | `unit`: "still normalises a creation draft that carries evidence…" plus the schema assertions above | The schema must not declare the collections, and `mutateWorkPlan` must still persist a draft that carries them (one evidence record, one resource). Tightening the normaliser as well as the schema would break the second half. |
| A runtime that cannot gate says so rather than pretending | covered | `wire`: "a real Pi RPC child executes work_plan and synchronizes its persisted result" | The same provider runs inside a real `pi --mode rpc` child with both tools registered by `piOutpostTools.ts`, and the absence assertion is deliberately not enforced there (`WORK_PLAN_EXPECT_GATED` is set only for the embedded server). `RpcRuntime.setToolPublished` returning `true` would be a lie no test could then catch — it returns `false`. |

## Measurement

`npx tsx server/scripts/probe-context-baseline.mts` — resting baseline **~7.8k tokens**
(prompt 7 134 chars, 15 tools 23 897 chars), from ~9.8k before this change and ~10.7k before
the trimming that preceded it. `work_plan` alone is 5 003 characters against 12 480.

## What is not proven here

Task 5 is open: no test says whether a model **finds** `work_plan_extended` after knowing
`work_plan`. The mechanism is proven; its use by a real model is not, and a scripted provider
cannot stand in for that.
