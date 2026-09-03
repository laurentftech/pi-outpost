## 1. The opener

- [ ] 1.1 Add `createWorkPlanOpenerToolDefinition()` beside the full definition in `server/src/workPlanTool.ts`: a `title` and an optional first task list, nothing else. Assert its published size stays under 600 characters, the way the full contract is budgeted.
- [ ] 1.2 Its execution creates the plan through the same `applyWorkPlanMutation` path as `action=create`, so normalisation, limits and refusals are unchanged and untested code does not appear behind a second door.
- [ ] 1.3 Its result names the tool that is now available and what it can do, so the agent's next call needs no guesswork.

## 2. Registration and activation

- [ ] 2.1 Register both definitions in `makeCreateRuntime` (`server/src/index.ts`); the initially active set excludes `work_plan` when the bound session has no plan, and excludes the opener when it has one.
- [ ] 2.2 In `server/src/embeddedRuntime.ts`, flip the active set when the plan state changes: after the opener runs, after any mutation that clears the plan, and on every session bind.
- [ ] 2.3 Derive the state from the persisted plan (`loadWorkPlan`), never from a flag held beside it.
- [ ] 2.4 The RPC runtime keeps both inactive-free: it publishes the full contract always, and says so in one comment rather than pretending to gate.

## 3. The prompt follows the toolset

- [ ] 3.1 `server/src/systemPrompt.ts`: the work-plan guidance block belongs to the full contract. At rest, one sentence about when to open a plan; the block returns with the tool.

## 4. Proof

- [ ] 4.1 Unit: a session with no plan publishes the opener and not `work_plan`; one with a plan publishes the reverse.
- [ ] 4.2 Unit: opening a plan activates the full contract, and `clear` returns to the opener.
- [ ] 4.3 Wire: a real server over a real WebSocket, where the agent's tool inventory is what the snapshot reports before and after a plan is opened.
- [ ] 4.4 Measure: re-run `server/scripts/probe-context-baseline.mts` and record the resting baseline in `scenario-coverage.md`. The claim is ~9.8k → ~7k.
- [ ] 4.5 Running app: open a plan from the bench and confirm the agent's next call uses the full contract without being told twice — the mechanism can be right while the *use* of it is not.

## 5. Validation

- [ ] 5.1 `scenario-coverage.md` for every scenario in the delta.
- [ ] 5.2 `npm run check:scenarios`, `openspec validate --strict`, focused suites.
