# Verification

Recorded for task 4.3. Every command below was run from the repository root on
macOS (darwin 24.6.0, Node 24) against the working tree of this change, after the
final source edit.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass (root, `web`, `@pi-outpost/embed`) |
| `npx openspec validate add-workspace-outcome-view --strict` | `Change 'add-workspace-outcome-view' is valid` |
| `node --test server/test/outcome-server.test.mjs` | 2 passed |
| `npx vitest run src/useAgent.test.ts -t "Outcome"` (in `ui/`) | 5 passed |
| `npm test --workspace ui` | 64 files, 1446 passed |
| `npm test --workspace server` | 1782 passed, 0 failed |
| `npm run build` | `done: pi-outpost 0.18.0` |
| `npm run build:e2e-host` | built |
| `npx playwright test --config e2e/playwright.config.ts outcome` | 5 passed |
| `npx playwright test --config e2e/playwright.config.ts` (whole suite) | 63 passed |
| `check-scenario-coverage.mjs --all` | `✓ add-workspace-outcome-view: 22 scenario(s), all covered with existing citations` |

The scenario gate ships on `main` (PR #148); this branch predates that merge, so it
was run from the `pi-outpost-gate` worktree with `PI_OUTPOST_SCENARIO_ROOT` pointed
at this tree.

## What the running app proved that the suites did not

`e2e/outcome.spec.ts` drives the real server with two git repositories under one
workspace, a plan carrying passed, failed and informational evidence, and a second
project. Four specs:

1. the panel renders the recorded plan counts, the blocked reason, the conservative
   `Verification failed` aggregate, both repositories' files with their states, and
   no completion claim anywhere in its text;
2. a task entry opens the Work Plan on that task and a file entry opens the confined
   viewer on that file's real content;
3. a burst of eight writes, then deleting what is on screen, then thrashing the
   drawers, settles on one truthful result with nothing stuck loading;
4. switching project closes the drawer with the project it described, and reopening
   shows the new workspace's own (empty) state rather than the previous one's.

Spec 4 is what corrected the implementation: `applySnapshot` now clears `outcome`,
so a result already on screen does not survive into the next session or workspace.
Removing that single line makes the hook test
"drops a loaded Outcome when the workspace or the session it describes is replaced"
fail — checked by mutation, not assumed.

## Code review (task 4.5)

`codex-review --uncommitted` returned two P2 findings, no P0/P1. Both were verified
at the cited lines and fixed:

1. **Outcome never re-requested after a reconnect** (`ui/src/useAgent.ts`). The close
   handler clears what was in flight and the reconnect snapshot clears the result, so
   a drawer left open had nobody left to ask and rendered "Loading Outcome…" until it
   was closed. A connect-driven effect now re-asks whenever the drawer is active —
   the same shape as the existing root-listing recovery. Asserted by
   `ui/src/useAgent.test.ts` "asks again for an open Outcome once the connection comes
   back"; removing the effect makes it fail. The e2e spec covering the same drop
   passes either way — the real server happens to send an unrelated invalidation on
   reconnect — so it is recorded as recovery evidence, not as proof of this fix.
2. **A task request replayed over later selections** (`ui/src/components/WorkPlanPanel.tsx`).
   `requestedTaskId` stayed set after navigating from Outcome, so every subsequent plan
   update — and the agent rewrites the plan constantly — re-selected that task over
   whatever the reader had selected since. The panel now reports the request handled
   and `App` drops it, making navigation a one-shot event. Asserted by
   `WorkPlanPanel.test.tsx` "does not replay a handled request over what the reader
   selected afterwards"; removing the acknowledgement makes it fail.

Every command in the table above was re-run after those two fixes.

## Known limits

- Playwright covers this change on Chromium only, which is the project's existing
  e2e configuration.
- The `e2e` Outcome server writes into a temporary workspace; spec 3 restores the
  files it deletes so specs remain order-independent, but they share one server.
