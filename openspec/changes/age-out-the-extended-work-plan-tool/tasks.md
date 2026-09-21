# Tasks

## 1. Enrol the extended tool in the idle count

- [x] 1.1 `publishWorkPlanTools` enrols `work_plan_extended` in `documentToolIdleTurns`
      when it publishes it, and removes it when it withdraws it. Guarded on the runtime's
      own answer: `setToolPublished` returns `false` where the session never registered
      the tool — the RPC child — and there is nothing to age there.
- [x] 1.2 `ageDocumentTools` gives it `WORK_PLAN_EXTENDED_IDLE_LIMIT` (5) rather than the
      extractors' `used`/`unused` pair. The `unused: 1` threshold exists to pay back a
      wrong guess and there is no guess here; reaching it through
      `documentToolsEverUsed` would have said the opposite of what is meant.
- [x] 1.3 No change needed in the `tool_start` handler: it already resets the count for
      any tool in the map, and records it as used this turn so the turn that called it is
      not counted as idle.
- [x] 1.4 No change needed in the `tool_result` handler: it already calls
      `publishWorkPlanTools` from inside the turn on every successful Work Plan call,
      which is both the reset and the way back.

## 2. Ordering

- [x] 2.1 `withholdDocumentTools` clears the idle counts, so it now runs *before*
      `publishWorkPlanTools` at the three sites that call both — the initial bind, the
      session-replacement sync, and a workspace started after boot. Left as it was, the
      clear would drop the enrolment and the tool would be published and never aged.

## 3. Tests

- [x] 3.1 `server/test/workPlanToolsWire.test.mjs`, over a real server and a real
      embedded session, asserting the tool list the *provider* was sent: absent before a
      plan, published within the turn that creates one, present through five quiet turns,
      absent on the sixth, and back after a `work_plan` call.
- [x] 3.2 The plan's survival is read from a second connection's `hello` snapshot, not
      inferred from the republication — which would pass equally if the plan had been
      destroyed and remade.
- [x] 3.3 Mutation-checked rather than trusted green: with `server/src/index.ts` reverted
      to `HEAD`, the test fails on `five idle turns after the plan was last touched, and
      it is withdrawn`. Restored and re-run green.
- [x] 3.4 `npm run typecheck` and `npm run lint` clean (lint warnings are pre-existing,
      all in `web/`, none in a touched file).

## 4. Not done here

- [ ] 4.1 `documentToolsLast` (`server/src/workspace.ts`) moves tools published
      mid-session to the end of the list, so a caching provider keeps everything ahead of
      them. `work_plan_extended` is published mid-session and is not in that set — it was
      not before this change either, and adding it reorders the toolset for every
      deployment. Worth its own change, with its own measurement.
