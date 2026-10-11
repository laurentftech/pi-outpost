# Scenario coverage — operator-command-policy

One new capability, `operator-command-policy` (4 requirements, 6 scenarios). Evidence:

- **Over a real connection:** `server/test/commandPolicyWire.test.mjs` boots the server with a real
  extension that registers `setup-creds` and `status` and a `session_start` hook. Each leaves a marker
  file when it runs, so a refused command is proved not to have run. Provider credentials are stripped
  from the server's environment, so nothing ever reaches a model.
- **The rule and the configuration:** `server/test/commandPolicy.test.ts`.

## operator-command-policy

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| BlockedCommandsAreNotOffered | covered | `server/test/commandPolicyWire.test.mjs` — "BlockedCommandsAreNotOffered + ATypedBlockedCommandDoesNotRun + TheExtensionKeepsWorking": the `hello` command list holds `status` and not `setup-creds`, and no `extensions_bound` list holds it. `server/test/commandPolicy.test.ts` — "a blocked pattern leaves its commands out, skills included, whatever the case", "glob characters are the only special ones". |
| AnAllowlistLimitsTheCommands | covered | `server/test/commandPolicyWire.test.mjs` — "AnAllowlistLimitsTheCommands: only what it names, and a message beginning with a slash is still a message": the `hello` list is exactly `["status"]`, `/setup-creds` is refused, `/status` runs. `server/test/commandPolicy.test.ts` — "an allowlist offers only what it names, and a blocked pattern still wins over it". |
| ATypedBlockedCommandDoesNotRun | covered | `server/test/commandPolicyWire.test.mjs` — the first test: `/setup-creds key=abc`, `/SETUP-creds` and `  /setup-creds` each get the error "This command is not available.", which does not contain "setup"; an `edit_prompt` into `/setup-creds` gets the same; no `user` echo arrives; the `setup-ran` marker never exists. `server/test/commandPolicy.test.ts` — "a blocked name is refused whether it exists or not, and in any case". |
| AMessageBeginningWithASlashIsStillAMessage | covered | `server/test/commandPolicyWire.test.mjs` — the allowlist test: `/tmp is full` gets an error that is not the command refusal (it went on as a message, and fails for want of a model). `server/test/commandPolicy.test.ts` — "an allowlist refuses a registered command it does not name, never a plain message"; "the command is the first word after the slash" (`/etc/hosts is wrong` names none). |
| TheExtensionKeepsWorking | covered | `server/test/commandPolicyWire.test.mjs` — the first test: with `setup*` blocked, the `status` command of the same extension writes its marker, and the `hook-ran` marker of its `session_start` hook exists. |
| AnUnusablePatternStopsStartup | covered | `server/test/commandPolicy.test.ts` — "refuses at startup what cannot be a command name": `loadConfig` rejects a non-array, `["/"]` naming `blockedCommands[0]`, and `["status", "two words"]` naming `allowedCommands[1]`; "reads both lists, a leading slash forgiven". |
