## Tasks
- [x] Pass the prompt's disposition through both runtimes; echo and mark busy only for `queued` and `started`.
- [x] `btwExtension.ts`: serialise the branch within the budget, call the session's model with no tools, show the answer in the `btw` widget, cancel a pending question, clear on `/btw` and on `session_start`.
- [x] Register it in the embedded runtime's `extensionFactories` and in the RPC child's pi-outpost extension.
- [x] README and `docs/how-to.md`: `/btw`.
- [x] Side-note panel: title line, close control (× sends `/btw`), follow-ups through an in-memory thread forgotten on close.
- [x] Unit tests for each scenario; exercise the running app (a question asked mid-turn, monkey pass); strict OpenSpec validation; scenario coverage.
