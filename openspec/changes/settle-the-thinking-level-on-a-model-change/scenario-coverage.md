# Scenario coverage

Every `#### Scenario:` in the three delta files, enumerated with
`rg '^#### Scenario:' openspec/changes/settle-the-thinking-level-on-a-model-change/`.
All three requirements are ADDED, so every scenario below is new work — nothing is
retained from an existing requirement.

Test files:

- `server/test/thinkingLevels.test.ts` (`clamp`) — the shared `clampThinkingLevel` fallback
- `server/test/pi-rpc.test.ts` (`rpc`) — the RPC runtime over the real fake-pi-rpc child
- `server/test/pi-rpc-server.test.mjs` (`wire`) — a real server, a real WebSocket, a real child
- `ui/src/components/ModelBar.test.tsx` (`bar`) — the `ThinkingControl` component

## api — SettleTheThinkingLevelOnAModelChange

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| ADeclaredNarrowingSettlesTheLevel | covered | `wire`: "a model change settles the thinking level on the new model's scale, and says so" — `server/test/pi-rpc-server.test.mjs` | The server is configured with `thinkingLevels` declaring `local/plain` as `["off"]`, the child starts on `high`. After `set_model`, the test waits for `thinking_changed` and asserts `off`, then reads the child's command log and asserts it received exactly one `set_thinking_level` with `off`. Dropping the `settleThinkingLevel` call makes the `thinking_changed` wait time out; broadcasting without moving the agent makes the command-log assertion fail. |
| AnAcceptedLevelSurvivesTheChange | covered | `wire`: same test, second half — `server/test/pi-rpc-server.test.mjs` | Switching back to `local/thinker` (accepts `off`…`high`) with the level on `off`: the test asserts `thinking_changed` still carries `off` **and** that the command log holds exactly one `set_thinking_level` for the whole test. A settling that reset the level, or that re-set an already-accepted one, fails on the second assertion. |
| TheFallbackStepsDownRatherThanUp | covered | `clamp`: "steps down rather than up: a model that tops out below the current level" and "steps down over a gap to the nearest level below" — `server/test/thinkingLevels.test.ts` | `clampThinkingLevel("high", ["off","low"])` must be `low`, and `clampThinkingLevel("high", ["off","low","medium","xhigh"])` must be `medium`, not `xhigh`. An upward-first search returns `xhigh` on the second and fails. The companion case ("steps up only when nothing below is on offer") pins the other direction so the rule is not simply "always go down". |

## pi-rpc-runtime — TheReportedThinkingLevelFollowsTheChild

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| AClampedLevelIsReReadAfterAModelChange | covered | `rpc`: "re-reads the level the child clamped when the model changed" — `server/test/pi-rpc.test.ts` | The fake child now clamps inside `set_model` exactly as the real one does (`thinkingLevelsByModel` in `server/test/fixtures/fake-pi-rpc.mjs`) and emits nothing. The test asserts the snapshot reads `high` before and `off` after `setModel("fake","plain")`. Removing the `refreshThinkingLevel()` call leaves the mirror on `high` and the test fails — verified by reverting the two source files and running the suite: 4 failures, this among them. |

## pi-rpc-runtime — AModelKeepsItsReportedCapabilitiesAcrossASelection

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| ASilentSetModelAnswerKeepsTheCatalogsCapability | covered | `rpc`: "keeps what the catalog says a model reasons when set_model does not repeat it" — `server/test/pi-rpc.test.ts` | The child is scripted to answer `set_model` with `null`. The test asserts both the returned model and the snapshot report `reasoning: true`. Without the catalog fallback, `toModel(null)` yields nothing, the runtime falls back to `{provider, id}`, and the server reads `reasoning ?? false` — which is how the bench lost the whole 🧠 control on a model change. |

## components — AModelWithOneLevelIsStatedNotDrawnAsARange

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| ASingleAcceptedLevelIsStated | covered | `bar`: "states the single level a model accepts instead of an immovable slider" — `ui/src/components/ModelBar.test.tsx` | With `thinkingLevels: ["off"]` the popover must contain no element labelled `Thinking level` and must name `off` in its sentence. The previous code rendered a range with `max="0"`; the `queryByLabelText(...)` assertion fails against it. |
| ALevelOutsideTheAcceptedSetIsStillNamed | covered | `bar`: "renders at the first stop when the current level is not one the model accepts" — `ui/src/components/ModelBar.test.tsx` | Current level `high`, accepted set without it: the slider sits at index `0` **and** the button's text still contains `high`. A control that relabelled itself from the stop it landed on — showing `off` — fails the second assertion. |

## Suites run

- `node --import tsx/esm --test test/thinkingLevels.test.ts test/pi-rpc.test.ts` — 42 pass, 0 fail.
- `node --import tsx/esm --test test/pi-rpc-server.test.mjs` — 6 pass, 0 fail.
- `npx vitest run src/components/ModelBar.test.tsx` — 21 pass, 0 fail.
- Negative check: with `server/src/index.ts` and `server/src/rpcRuntime.ts` reverted, the
  RPC test and the wire test both fail (the wire test on a 60 s `thinking_changed` timeout).
