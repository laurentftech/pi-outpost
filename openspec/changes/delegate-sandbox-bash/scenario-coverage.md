# Scenario coverage — delegate-sandbox-bash

Capabilities: `sandbox-delegated-bash` (new), `file` (one added requirement).

The scenarios run on the real server and the embedded agent: a provider fixture makes the agent call `bash`, and the tool
result shows whose `bash` ran. `server/test/fixtures/confined-bash-extension.mjs` stands in for pi-landstrip.

Also checked by hand against the real **pi-landstrip 0.19.4**, installed with `pi install npm:pi-landstrip` into an isolated
agent directory:
- with `bashFrom: "npm:pi-landstrip"`, the session starts with landstrip's `bash` active;
- with `bashFrom: "npm:wrong-name"`, the session is refused, and the refusal reports that the `bash` came from
  `npm:pi-landstrip`, with its path.

## sandbox-delegated-bash

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheDelegateIsNamedInTheSandbox | covered | `server/test/config.test.ts` — "keeps the extension it names, trimmed, and leaves it out when unset"; "refuses a name that names nothing". |
| ADelegatedBashIsTheExtensions | covered | `server/test/sandboxDelegatedBash.test.mjs` — "ADelegatedBashIsTheExtensions": the registered `bash` is the extension's file, and the agent's call returns "ran confined", never the shell's output. |
| WithoutDelegationTheExtensionIsShadowed | covered | Same file — "WithoutDelegationTheExtensionIsShadowed": the registered `bash` has source `sdk`, and the call returns the shell's output. |
| NoBashMeansNoDelegate | covered | Same file — "NoBashMeansNoDelegate": no `bash` among the session's tools. |
| AMissingDelegateRefusesTheSession | covered | Same file — "AMissingDelegateRefusesTheSession": the server does not start, and the message names `bashFrom`, the extension and the refusal. |
| AnotherExtensionsBashIsRefused | covered | Same file — "AnotherExtensionsBashIsRefused": refused, and the message contains the other extension's path. |
| SettingsKeepTheDelegation | covered | Same file — "SettingsKeepTheDelegation": after an `update_config` apply, the agent's call still returns "ran confined". Fails with the carry-over removed (checked). |
| AShadowedExtensionBashIsWarnedAbout | covered | `server/test/sandboxDelegatedBash.test.mjs` — "AShadowedExtensionBashIsWarnedAbout": the notification is `notify`/`warning`, names the extension file, says "not confined" and carries the exact `bashFrom` line; the server log has the WARNING; a second browser connecting later gets it too. Also seen in the running app: the toast with that text, dismissible. |
| NoWarningWhenTheExtensionsBashIsUsedOrThereIsNone | covered | Same file — "no warning when the extension's bash is the one, or when there is no bash": neither notification nor log line, with `bashFrom` and with `allowBash` off. |
| ExtensionsSeeTheServersAgentDirectory | covered | Same file — "ExtensionsSeeTheServersAgentDirectory": started with `PI_CODING_AGENT_DIR` elsewhere, a probe extension's `getAgentDir()` is the configured `agentDir`. |
| TheTerminalKeepsTheUsersAgentDirectory | covered | `server/test/terminalManager.test.ts` — "puts back what the user started the server with, and drops what they did not set". |
| TurningBashOnWithoutTheDelegateIsRefused | covered | Same file — "TurningBashOnWithoutTheDelegateIsRefused": the reply is an error naming the reason; a fresh connection sees `allowBash` off and no `bash`; the file still has `allowBash: false` and keeps `bashFrom`. |

## file

All in `server/test/sandboxPiConfig.test.ts`, against the real tools built by `createSandboxedTools`.

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| WriteAndEditRefuseAPiDirectory | covered | "write and edit refuse a .pi directory, at the top or nested": four refusals naming the .pi directory; the project's sandbox.json under .pi unchanged, and the nested directory never created. |
| ASymlinkIntoPiIsRefused | covered | "a symlink into .pi is no way round it" (a junction on Windows). |
| OtherPathsStayWritable | covered | "everything else is still writable, .pi-outpost and look-alikes included": each written and present on disk. |
| PiConfigurationStaysReadable | covered | "reading .pi is still allowed". |
| EveryFileWritingToolIsHeld | covered | "every tool that writes a file is held to it, through the one check they share": `assertWritableDestination` refuses `.pi` paths, and `write_structure_table` asked for a table.md under .pi is refused, with no file written. |
| LoadedSkillsAreReadable | covered | `server/test/sandboxSkillRead.test.mjs` — "LoadedSkillsAreReadable": on the real server and agent (a provider has the agent `read`), the bundled structured-exchange skill and its timelines reference, and a skill installed into an agent directory outside the project with a file beside it, all return their content. Failed before the change (reproduced: "outside the sandbox"). |
| OnlySkillsBecomeReadable | covered | Same file — "OnlySkillsBecomeReadable": the agent directory's auth.json and pi-outpost's own package.json are refused as outside the sandbox, and the key never appears. |
