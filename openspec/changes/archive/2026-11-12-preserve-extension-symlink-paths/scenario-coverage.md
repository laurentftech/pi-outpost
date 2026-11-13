# Scenario coverage

| Scenario | Status | Test file and name |
|---|---|---|
| PreservesTheChosenExtensionAlias | covered | `server/test/extensionPathsWire.test.mjs`: applied symlink checks acknowledgement, saved alias and duplicate removal; `e2e/extension-symlinks.spec.ts`: browser picker, visible alias, disk readback and actual registered command. |
| RetargetedAliasLoadsAfterRestart | covered | `server/test/extensionPathsWire.test.mjs`: applied symlink, old target deleted and new process checks the new command present and old one absent from saved settings. |
| RemovesTheAliasWithoutRemovingItsTarget | covered | `server/test/extensionPathsWire.test.mjs`: applied symlink unregisters command and checks link; `server/test/resourceRepositories.test.ts`: configured extension alias stays removable with canonical loaded identities; browser removes via inventory and reads back unchanged target code. |
| RefusesInvalidExtensionAliases | covered | `server/test/extensionPathsWire.test.mjs`: invalid extension paths leave settings/session unchanged; browser deletes the alias after selection and requires an error with unchanged disk settings. |

Local validation on 2026-11-05: real connection suite 5/5, resource repository suite 26/26,
configuration/directory suite 25/25, resource manager component suite 49/49, and the built running
app's focused Playwright test 1/1. The connection test failed before the fix with the canonical
target in place of the expected alias. Windows junctions use the same assertions in CI; that
platform's result is still pending. Existing repository preview confinement assertions remain intact.
