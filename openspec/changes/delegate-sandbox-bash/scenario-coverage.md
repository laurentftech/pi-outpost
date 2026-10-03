# Scenario coverage — delegate-sandbox-bash

Capability: `sandbox-delegated-bash` (new).

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
| TurningBashOnWithoutTheDelegateIsRefused | covered | Same file — "TurningBashOnWithoutTheDelegateIsRefused": the reply is an error naming the reason; a fresh connection sees `allowBash` off and no `bash`; the file still has `allowBash: false` and keeps `bashFrom`. |
