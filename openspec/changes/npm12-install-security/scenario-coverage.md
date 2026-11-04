# Scenario coverage

| Scenario | Status | Evidence |
| --- | --- | --- |
| UnreviewedRepositoryScriptsFailClosed | covered | `scripts/check-npm-install.mjs`: strict project rejects the canary with ESTRICTALLOWSCRIPTS and no marker is written. |
| ConsumerInstallsKeepTheirTerminal | covered | `scripts/check-npm-install.mjs`: global and npx fresh caches, installed CLI version, real PTY output and exit status; CI npm-install matrix runs Linux, Windows and macOS. |
| UnapprovedDependencyScriptsStayBlocked | covered | `scripts/check-npm-install.mjs`: global and npx include a lifecycle canary and assert its marker is absent while the approved native PTY works. |
| WindowsUpdatesKeepRegistryDataOutOfTheShell | covered | `server/test/update.test.ts`, "runs a Windows install through cmd.exe with a fixed shell command": exact selective permissions and a registry with shell metacharacters absent from command arguments. |

Existing update channel, registry and doctor behavior is guarded by the focused update/doctor suites.
Final platform results and running-app verification are recorded after execution.
