## 1. Partition the contract

- [ ] 1.1 In `server/src/workPlanTool.ts`, derive two definitions from one action partition: `work_plan` (`get`, `create`, `add_task`, `update_task`, `move_task`, `remove_task`, `clear`) and `work_plan_extended` (`replace`, `set_dependencies`, `set_resources`, `set_evidence`). One list, two schemas — not two hand-maintained copies.
- [ ] 1.2 Drop `evidence` and `resources` from the creation task shape at both nesting levels. `mutateWorkPlan` keeps accepting them, so an older client's draft still normalises; only the advertisement goes.
- [ ] 1.3 Budget tests, as in `work-plan.test.ts` today: `work_plan` under 4 000 characters, `work_plan_extended` under 7 000. Raising a ceiling is allowed; raising one silently is not.
- [ ] 1.4 An action refused because it belongs to the other tool SHALL be refused by name, saying which tool carries it.

## 2. Publication follows the plan

- [ ] 2.1 Register both definitions in `makeCreateRuntime` (`server/src/index.ts`).
- [ ] 2.2 In `server/src/embeddedRuntime.ts`, activate `work_plan_extended` when the bound session has a plan, after a `create`, and deactivate it after `clear` — always derived from `loadWorkPlan`, never from separate state.
- [ ] 2.3 Activation takes effect within the turn: the call that creates a plan returns after the toolset has changed.
- [ ] 2.4 The RPC runtime publishes both at all times, with a comment saying why rather than emulating the gating.

## 3. The prompt follows the tools

- [ ] 3.1 `server/src/systemPrompt.ts`: evidence guidance belongs with the tool that carries evidence. A session with no plan is told a plan can be opened, not how to record evidence on it.

## 4. Proof

- [ ] 4.1 Unit: a session with no plan publishes `work_plan` alone; one with a plan publishes both.
- [ ] 4.2 Unit: `create` activates the extended tool, `clear` withdraws it.
- [ ] 4.3 Unit: every action appears in exactly one tool, checked against `WORK_PLAN_ACTIONS` rather than a list written by hand — a new action must land somewhere on purpose.
- [ ] 4.4 Unit: a creation draft carrying evidence still normalises, though the schema no longer advertises it.
- [ ] 4.5 Wire: a real server and WebSocket, tool inventory before and after a plan is opened.
- [ ] 4.6 Measure: re-run `server/scripts/probe-context-baseline.mts`; record the resting baseline in `scenario-coverage.md`. The claim is ~9.8k → ~7.5k for a conversation with no plan.

## 5. Prove the agent copes, not only the code

- [ ] 5.1 A live run: ask a model to plan a small piece of work, then to record a test result against one of its tasks. Read the transcript. What is being tested is whether it finds `work_plan_extended` after knowing `work_plan` — the mechanism can be right while the use of it is not.
- [ ] 5.2 The same in the bench, so the plan panel is watched while it happens.

## 6. Validation

- [ ] 6.1 `scenario-coverage.md` for every scenario in the delta.
- [ ] 6.2 `npm run check:scenarios`, `openspec validate --strict`, focused suites.
