## Tasks
- [ ] Pass the prompt's disposition through both runtimes; echo and mark busy only for `queued` and `started`.
- [ ] `btwExtension.ts`: serialise the branch within the budget, call the session's model with no tools, show the answer in the `btw` widget, cancel a pending question, clear on `/btw` and on `session_start`.
- [ ] Register it in the embedded runtime's `extensionFactories` and in the RPC child's pi-outpost extension.
- [ ] README and `docs/how-to.md`: `/btw`.
- [ ] Unit tests for each scenario; exercise the running app (a question asked mid-turn, monkey pass); strict OpenSpec validation; scenario coverage.
