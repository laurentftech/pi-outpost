# Scenario coverage — age-out-the-extended-work-plan-tool

Every scenario the delta declares, and the assertion that would fail if its contract
broke. A scenario is `covered` only when a test's *assertions* — not its name — check the
GIVEN/WHEN/THEN at the boundary the scenario describes.

The boundary here is the payload the model receives. A snapshot field saying what the
server believes it published is a second-hand account; the tool list sent with a request
is the thing that costs tokens and the thing the agent can call. So the fixture provider
records `toolsOf(context)` for every request, and every row below reads that log — not
the `hello` frame, except where a row is explicitly about persisted state.

Mutation-checked, not trusted green (tasks.md §3.3): with `server/src/index.ts` reverted
to `HEAD` the suite fails on `five idle turns after the plan was last touched, and it is
withdrawn`, which is the assertion this change exists to make true. The three rows below
share one test because they are one continuous session — the counts only mean anything in
sequence.

Capability: `work-plan` — one added requirement, `The extended Work Plan tool is
withdrawn once the plan stops being worked` (3 scenarios).

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| A plan that is being worked keeps the extended tool | covered | `server/test/workPlanToolsWire.test.mjs` — "the extended Work Plan tool is withdrawn once the plan stops being worked". After the create, the loop asserts `during.includes(EXTENDED)` on the request of each of five quiet turns, one assertion per turn (`the extended half survives N idle turn(s)`). A limit set too low fails on the exact turn it was lowered to, so the row distinguishes 5 from 4 rather than merely "it survives a while". |
| A plan nobody touches loses the extended tool | covered | Same test. `assert.ok(!forgotten.includes(EXTENDED))` on the sixth quiet turn's request — the assertion that fails on `HEAD`, where the tool never leaves. `assert.ok(forgotten.includes("work_plan"))` on the same list holds the other half of the contract: withdrawing one is not withdrawing both. The **AND** on the persisted plan is read from a second connection's `hello.workPlan`, asserting both its presence and its title, rather than inferred from the republication below — that inference would pass just as well against a plan destroyed and remade. |
| The agent brings the extended tool back by itself | covered | Same test, final step. The fixture answers `TOUCH THE PLAN` with a real `work_plan` call (`action: get`) — only possible because the common half was never withheld — and the request *after* that turn's tool result must carry the extended tool again (`touching the plan through work_plan brings the extended half back`). Publishing from the queued sidecar reload instead of the tool result leaves the next request without it, which is what this row would catch. |

## What no row here claims

The fixture provider is scripted: it calls `work_plan` because the prompt contains a
marker, not because a model judged it the right tool. So these rows say the mechanism
works — they do not say an agent that loses the extended tool mid-plan notices, reaches
for the common one, and finds its way back unprompted. That is behaviour, it needs a live
model, and the archived change this one builds on carried the same gap as its own open
task 5.

Nor is any row a UI claim: nothing in this change touches a component, a tool
description, or a message the model reads. The tool's own schema and description are
untouched — only when it is sent.
