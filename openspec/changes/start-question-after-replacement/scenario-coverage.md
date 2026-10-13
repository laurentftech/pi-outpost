# Scenario coverage — start-question-after-replacement

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ANewSessionsStartQuestionReachesTheClient | covered | `server/test/promptWaitsForExtensionsWire.test.mjs` — "ANewSessionsStartQuestionReachesTheClient": a real server with an extension asking "Start N" in each `session_start`; after `new_session`, an `extension_ui_request` titled "Start 2" is received after the `session_replaced` message, "Start 1" (answered) is not received again after it, and answering "Start 2" ends with the client's replayed state no longer showing the extensions starting. Fails before the fix ("never reached the client after the replacement"). |
