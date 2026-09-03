## 1. Partition the contract

- [x] 1.1 Two definitions from one action partition in `server/src/workPlanTool.ts` — `WORK_PLAN_COMMON_ACTIONS` and `WORK_PLAN_EXTENDED_ACTIONS`, both `satisfies readonly WorkPlanAction[]`, with one shared executor so the split is in what is published and never in what runs.
- [x] 1.2 `evidence` and `resources` dropped from the creation task shape at both nesting levels **and** from `add_task`'s task shape. `mutateWorkPlan` still normalises a draft carrying them, so stored plans and non-tool callers are unaffected; a tool call carrying them is refused by pi's own validation, which is the narrowing this buys.
- [x] 1.3 Budget tests: `work_plan` under 5 200 characters, `work_plan_extended` under 6 000 (`keeps each published definition under its context budget`).
- [x] 1.4 An action asked of the wrong tool is refused by name, saying which tool carries it (`workPlanToolFor`, asserted in `gives every action exactly one home…`).

## 2. Publication follows the plan

- [x] 2.1 Both registered in `makeCreateRuntime` and in `workspaceOptions`' unconfined set (`server/src/index.ts`), and in `piOutpostTools.ts` for an RPC child.
- [x] 2.2 `AgentRuntime.setToolPublished(name, published)`: `EmbeddedRuntime` flips the SDK's active set (which rebuilds the system prompt, so the schema goes with it); `RpcRuntime` returns `false`.
- [x] 2.3 `publishWorkPlanTools(workspace, plan)` is called wherever the plan can change — the boot bind, a project started later, a session replacement, and a work_plan tool result. Always derived from the plan, never from a flag.
- [x] 2.4 Within the turn: publication happens **synchronously in the `tool_end` handler**, from the plan the result already carries. Doing it in the queued sidecar reload was too late — the agent's next request went out first, and the live provider test caught exactly that (`work_plan_extended was not published once a plan existed`).

## 3. The prompt follows the tools

- [x] 3.1 Each tool's `promptGuidelines` carry its own operations: the evidence example and the replacement rule moved to `work_plan_extended`, and the common tool names where they went. `WORK_PLAN_SYSTEM_GUIDANCE` stays whole and always sent — it is behavioural selection guidance ("skip a plan for trivial interactions"), the system prompt is fixed at session creation and cannot vary with plan state, and this repo deliberately keeps that guidance out of tool contracts (`keeps behavioral selection guidance out of the mechanical tool contract`).

## 4. Proof

- [x] 4.1 `work-plan.test.ts` — both schemas bounded, action enums partition the actions, creation advertises no collections.
- [x] 4.2 `publishing the extended tool` — the real `EmbeddedRuntime.setToolPublished` over a stand-in session: adds, withdraws, leaves the rest of the set alone, does nothing when already correct, reports `false` for an unregistered name.
- [x] 4.3 `gives every action exactly one home…` — checked against `WORK_PLAN_ACTIONS`, so a new action cannot be forgotten by both tools.
- [x] 4.4 `still normalises a creation draft that carries evidence…`.
- [x] 4.5 Wire: `work-plan-server.test.mjs` "the embedded SDK provider receives the same fully typed work_plan schema" now asserts, from inside a real provider, that `work_plan_extended` is absent before any plan exists and present afterwards — and the turn goes on to call it. The RPC test asserts the same tools reach a real `pi --mode rpc` child, ungated.
- [x] 4.6 Measured with `server/scripts/probe-context-baseline.mts`: resting baseline ~9.8k → **~7.8k tokens**.

## 5. Prove the agent copes, not only the code

- [ ] 5.1 A live run: ask a model to plan a small piece of work, then to record a test result against one of its tasks, and read the transcript for whether it finds `work_plan_extended` on its own.
- [ ] 5.2 The same in the bench, with the plan panel watched while it happens.

## 6. Validation

- [x] 6.1 `scenario-coverage.md` for all 13 scenarios.
- [x] 6.2 `openspec validate --strict` valid; `npm run check:scenarios` clean; focused suites green (`work-plan` 53, `work-plan-server` 4, `pi-rpc`/`extensionPathsWire`/`pi-rpc-server` 43, `sandbox-tools`/`toolProgress`/`agent-runtime-config` included: 131).
