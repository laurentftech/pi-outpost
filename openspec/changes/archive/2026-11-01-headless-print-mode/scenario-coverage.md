# Scenario coverage

Inventory: `rg '^#### Scenario:' openspec/changes/headless-print-mode/` lists every scenario of the change, all of them below. `printMode.test.mjs` runs the CLI as a process with a provider fixture and reads stdout, stderr and the exit status apart. `printModeTurn.test.ts` drives the turn's client against a server that plays the protocol.

| Applicable scenario | Status | Tests and assertions |
|---|---|---|
| APromptIsAnsweredOnStdout | covered | `server/test/printMode.test.mjs` "APromptIsAnsweredOnStdout: …" asserts exit 0, stdout exactly `done\n`, stderr holding `[server] http://127.0.0.1:<port>/`, and no server line on stdout. With the real model under MXC, stdout held the answer alone ("Le titre de la page est « Example Domain »"). |
| APromptFromStdin | covered | `printMode.test.mjs` "APromptFromStdin: …" pipes the prompt and asserts, from `--json`, the turn's `user` event carrying exactly it. |
| AFailedTurnExitsNonZero | covered | `printMode.test.mjs` "AFailedTurnExitsNonZero: …" makes the provider fail (`BASH_CALL_FAIL`) and asserts exit 1, "the turn failed: … provider down" on stderr, and nothing on stdout. "a model that is not allowed is refused, …" asserts exit 1 for a turn refused before it starts. |
| GrantsAreRefusedUnlessAllowed | covered | `server/test/printModeTurn.test.ts` "GrantsAreRefusedUnlessAllowed: …" asserts the exact `sandbox_grant_response` sent for each policy (`refuse` by default, `once`, `session`) and the line naming it on stderr. With the real model under MXC and `allowedHosts`: refused by default, allowed with `--grants once`, and the title fetched. |
| JsonPrintsTheTurnsEvents | covered | `printMode.test.mjs` "JsonPrintsTheTurnsEvents: …" parses every stdout line as JSON and asserts `agent_start`, `assistant_end` and `agent_end` among them. |
| AStrayPrintFlagIsRefused | covered | `server/test/cli.test.ts` "AStrayPrintFlagIsRefused: …" asserts a `CliError` naming the flag for `--json`, `--grants` and `--model` without `-p`, `-p` beside `doctor`, `--grants always`, a model without `/`, and a blank prompt. |
