# Tasks

- [x] 1.1 `embeddedRuntime.ts`: `rebind` emits `dialogs_cancelled` after cancelling the bridge's requests; `index.ts` forgets them.
- [x] 1.2 `index.ts`: after broadcasting `session_replaced`, broadcast the pending questions again.
- [x] 1.3 Wire test with an extension asking in each `session_start` (`server/test/promptWaitsForExtensionsWire.test.mjs`); checked in the running app with openlore's configuration question, including two "+ new" in a row.
