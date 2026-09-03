## 1. Settle the level on the model-change path

- [x] 1.1 Add `clampThinkingLevel(level, levels)` to `shared/src/protocol.ts`, beside `normalizeThinkingLevels`. Done — steps down first, up only when nothing below is offered, `off` as the floor. `server/test/thinkingLevels.test.ts` covers the accepted level, the two step-down cases, the gap, the step-up, and the empty set.
- [x] 1.2 Add `settleThinkingLevel(workspace)` to `server/src/index.ts` beside `acceptedThinkingLevels`, and call it after the `model_changed` broadcast in `set_model`. Done — it moves the agent's level through `setThinkingLevel` only when the accepted set excludes it, and broadcasts `thinking_changed` either way.

## 2. The RPC runtime reports the child's level and the model's capabilities

- [x] 2.1 Re-read `get_state` after `set_model` in `server/src/rpcRuntime.ts`. Done — `refreshThinkingLevel()`, called after `refreshThinkingLevels()`.
- [x] 2.2 Keep `reasoning` across a selection: where the `set_model` answer omits it, take it from the catalog `rpcRuntime` already holds. Done — `server/test/pi-rpc.test.ts` "keeps what the catalog says a model reasons when set_model does not repeat it". Found by the running-app pass, where the control disappeared entirely on a model change.
- [x] 2.3 Teach the fake child to clamp on a model change, as the real one does. Done — `thinkingLevelsByModel` in `server/test/fixtures/fake-pi-rpc.mjs` drives both `get_available_thinking_levels` and the silent clamp inside `set_model`. `server/test/pi-rpc.test.ts` "re-reads the level the child clamped when the model changed".

## 3. The control stops drawing a range that cannot move

- [x] 3.1 `ui/src/components/ModelBar.tsx`: a single accepted level is stated in words; the current level is named as itself when it is not one of the stops. Done — `ModelBar.test.tsx` "states the single level a model accepts instead of an immovable slider" and the extended "renders at the first stop when the current level is not one the model accepts".

## 4. Prove it on the wire

- [x] 4.1 `server/test/pi-rpc-server.test.mjs` "a model change settles the thinking level on the new model's scale, and says so" — a declared `["off"]` model, a session on `high`, over a real server and WebSocket: `thinking_changed` carries `off`, the child received exactly one `set_thinking_level` (`off`), and switching back to the wide-scale model leaves the level alone.

## 5. Coverage and validation

- [x] 5.1 `scenario-coverage.md` — every scenario of the three delta files matched to an assertion.
- [x] 5.2 Typecheck, focused suites and `openspec validate --strict`.

## 6. Prove it in the running app

- [x] 6.1 Drive the model switch in the running widget (`npm run bench`), with the bench's thinking server extended to hold a second model declared `["off"]` and a session starting on `high`. Done — see `verification.md`. The pass found two things no suite could: the fake child never answered `set_model` with a model, so the whole 🧠 control vanished on a switch (a real dialect gap, now closed by the catalog fallback in `rpcRuntime.setModel`), and the child's own clamp is now visible in the interface rather than hidden behind a stale label.
