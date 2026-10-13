# Scenario coverage — allowed-models-bind-the-session

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheSessionStartsOnAnAllowedModel | covered | `server/test/allowedModelsWire.test.mjs` — "TheSessionStartsOnAnAllowedModel": a real server whose agent directory defaults to `denied` with `allowedModels` naming `allowed`; the greeting lists only `allowed` and names it as the session's model, the turn's answer is "answered by allowed" (each model names itself), never "denied", and the agent directory's settings file still defaults to `denied`. Fails before the fix (greeting on `denied`). |
| AModelOutsideTheListIsRefused | covered | `server/test/allowedModelsWire.test.mjs` — "AModelOutsideTheListIsRefused": `set_model` to `denied` returns an error saying it is not available, no `model_changed` arrives, and the next turn is answered by `allowed`. Before the fix the model switched. |
| ANewSessionStaysOnAnAllowedModel | covered | `server/test/allowedModelsWire.test.mjs` — "ANewSessionStaysOnAnAllowedModel": after `new_session` the `session_replaced` snapshot names `allowed` and the turn is answered by `allowed`. Fails before the fix. |
