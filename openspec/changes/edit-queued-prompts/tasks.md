## 1. Server

- [x] 1.1 `QueuedPrompts` tracker: expectations, per-kind reconciliation of pi's queue, delivered/foreign entries, suspension during a take-back, unit tests. Done in `server/src/queuedPrompts.ts`, 15 tests. An expectation is matched only within its own queue, preferring an exact text — a test with an extension queuing a follow-up while our steer was in its input handlers found the first version taking the extension's message for ours.
- [x] 1.2 Runtimes: `clearQueue()`, `queueMessage()` and `canClearQueue` on the embedded runtime and on the RPC runtime (standard pi only). `queueMessage` uses pi's `steer`/`followUp`, which queue whether or not a turn runs: re-queueing through `prompt` would have started a turn when editing a prompt left pending by an abort.
- [x] 1.3 `handlePrompt`: registers an expectation for every prompt, echoes a queued prompt at delivery instead of acceptance, and holds the per-workspace queue lock until acceptance only.
- [x] 1.4 Protocol: `queue` carries `prompts`; `edit_queued_prompt`, `remove_queued_prompt`, `queued_prompt_refused`; `SessionSnapshot.queuedPrompts`.
- [x] 1.5 Edit and remove: take back, re-queue in order under the same ids, refuse a delivered target, keep the rest; wire tests on the embedded runtime, a real Pi RPC child, and the fake RPC child in OMP's dialect. Ids were first reassigned on every re-queue, which would have told a client editing another prompt that it was gone; the e2e test caught it.

## 2. Interface

- [x] 2.1 Pending bubbles with the pencil and ✕ in place of the dashed box (`UserMessage`'s queued variant); a refused edit, or an open edit whose prompt leaves the queue, goes to the composer after any draft.
- [x] 2.2 Component and reducer tests (`UserMessage.test.tsx`, `useAgent.test.ts`, `App.test.tsx`).

## 3. Send the queue now

- [x] 3.1 `send_queue_now`: stop a running turn and wait until idle, take the queue back, queue all but the first again as steers, send the first as a prompt — pi polls the steering queue as a run starts, so all of them go out in its first request. Wire tests after a stop and mid-turn (completed step kept, step in progress abandoned).
- [x] 3.2 `SendQueueNow`: one button under the pending bubbles; while a turn runs it asks inline what is lost and kept (a native `confirm()` is silently blocked in a sandboxed embed). Component, App and Playwright tests.

## 4. Verification

- [x] 4.1 Scenario matrix in `scenario-coverage.md`; `npm run check:scenarios`.
- [x] 4.2 Playwright in the running app (`e2e/queued-prompts.spec.ts`), with two monkey passes: an edit the agent overtakes, a double ✕, an abort, a reload, edit spam, two clients on one prompt, a new session under a queue.
- [x] 4.3 `openspec validate edit-queued-prompts --strict`; documentation impact.
