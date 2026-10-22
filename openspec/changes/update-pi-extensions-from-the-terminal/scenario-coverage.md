# Scenario coverage — update-pi-extensions-from-the-terminal

The command is tested at two levels. `server/test/piPackagesUpdate.test.ts` drives `runPiPackagesUpdate` and
`hintPiPackagesBehind` with injected listing, lookup and install steps, so every rule is checked without a
registry. `server/test/piPackagesUpdateCommand.test.mjs` runs the real `pi-outpost update` from the TypeScript
source, as a process, against a real npm and a registry of the test's own (`server/test/fakePiPackages.mjs`,
shared with the Settings wire test): an agent directory with `pi-fake-ext` 1.0.0 installed by npm, 1.1.0
published by the test. What is installed is read back from the agent directory's `node_modules`, and the
registry counts the requests it receives.

## Capability: `pi-package-updates` (9 scenarios)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| TheCheckListsThePackagesAndInstallsNothing | covered | `server/test/piPackagesUpdate.test.ts` — "TheCheckListsThePackagesAndInstallsNothing": a package at 1.0.0 is reported with 1.1.0 available, a pinned one as pinned at 2.0.0 and offered nothing, no install runs, exit 0; `server/test/piPackagesUpdateCommand.test.mjs` — "TheExtensionsAreUpdatedFromTheTerminal": `update --extensions --check` reports 1.0.0 → 1.1.0 and the version on disk is still 1.0.0 |
| TheExtensionFlagsBelongToUpdate | covered | `server/test/cli.test.ts` — "TheExtensionFlagsBelongToUpdate": `--extensions` and `--all` alone, on `init` and on `doctor` each throw a `CliError` naming `pi-outpost update` as their owner |
| TheExtensionsAreUpdatedFromTheTerminal | covered | `server/test/piPackagesUpdateCommand.test.mjs` — "TheExtensionsAreUpdatedFromTheTerminal": with no configuration file and `--agent-dir`, `update --extensions` exits 0, 1.1.0 is on disk in that directory, the output says 1.1.0 is installed and to restart pi-outpost, and nothing about pi-outpost's own version; a second run says 1.1.0 is the newest |
| AnInstallThatInstallsNothingIsAFailure | covered | `server/test/piPackagesUpdate.test.ts` — "AnInstallThatInstallsNothingIsAFailure": an install step reporting the package still at 1.0.0 is printed, no restart is suggested, exit 1. The step itself, `installNewerPiPackage`, is the one Settings uses; its "installed nothing" branch is `server/test/piPackagesWire.test.mjs` — "an install that fails leaves the installed version and says why" |
| AFailedLookupIsNotUpToDateInTheTerminal | covered | `server/test/piPackagesUpdate.test.ts` — "AFailedLookupIsNotUpToDateInTheTerminal": both packages are reported as "could not check" with the registry's error, nothing says "newest", nothing is installed, exit 1 |
| LockedExtensionsAreNotUpdatedFromTheTerminal | covered | `server/test/piPackagesUpdateCommand.test.mjs` — "LockedExtensionsAreNotUpdatedFromTheTerminal": a `pi-outpost.config.json` with `extensionLock: true` and the agent directory; the newer version is reported, `"extensionLock" is set: no pi package was updated`, 1.0.0 still on disk, non-zero exit; `server/test/piPackagesUpdate.test.ts` — the same rule with injected steps |
| CheckingOffLooksUpNoPackage | covered | `server/test/piPackagesUpdateCommand.test.mjs` — "CheckingOffLooksUpNoPackage": with `updateCheck: false` in the configuration the registry receives no request during the run, the output names `"updateCheck" is false`, 1.0.0 still on disk, non-zero exit; `server/test/piPackagesUpdate.test.ts` — the lookup step is never called |
| AllUpdatesTheExtensionsEvenWhenPiOutpostIsRefused | covered | `server/test/piPackagesUpdateCommand.test.mjs` — "AllUpdatesTheExtensionsEvenWhenPiOutpostIsRefused": the source runs as a checkout, which `update` refuses; `update --all` prints the checkout refusal, 1.1.0 is on disk, the output says it is installed, and the exit code is non-zero |
| APlainUpdateNamesTheExtensionsBehind | covered | `server/test/piPackagesUpdateCommand.test.mjs` — "APlainUpdateNamesTheExtensionsBehind": plain `update` prints the hint naming `pi-fake-ext` after its verdict on pi-outpost, with `pi-outpost update --extensions`, and 1.0.0 is still on disk; `server/test/piPackagesUpdate.test.ts` — the exact two lines, and silence when nothing is behind, a lookup fails, or listing throws |
