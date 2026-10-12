# Scenario coverage — fast-resource-inventory

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ASlowInventoryDoesNotHoldStartup | covered | `server/test/resourceInventoryStartup.test.mjs` — "ASlowInventoryDoesNotHoldStartup: the server greets its client first, the inventory follows": a real server whose git sleeps ten seconds when asked about one skill's repository, and logs it; at `hello` the log shows the question started and not ended, the greeting does not list the repository, and an `agent_resource_inventory` listing it and the skill arrives afterwards. Fails on the previous code. POSIX only (the slow git is a shell script). |
| OneQuestionPerRepository | covered | `server/test/resourceInventoryCost.test.ts` — "one question per repository, none for a resource outside every repository": the git observer sees exactly one `rev-parse --show-toplevel`, the repository lists its eight skills, the six outside are "Not backed by a Git repository" (fails on the previous code); "a .git git does not recognise is still git's call, asked once"; "a resource inside a nested repository belongs to the inner one, as git says". |
