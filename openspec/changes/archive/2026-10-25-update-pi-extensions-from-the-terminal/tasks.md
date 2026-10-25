## 1. Server

- [x] 1.1 Move Settings' install-and-verify step into `piPackages.ts` as `installNewerPiPackage`, and call it from `handleUpdatePiPackage`; verify `piPackagesWire.test.mjs` still passes
- [x] 1.2 Parse `--extensions` and `--all`, refuse them outside `update`, and document them in the help; verify `TheExtensionFlagsBelongToUpdate` in `cli.test.ts`
- [x] 1.3 `runPiPackagesUpdate`: list, look up, report, install, verify; pinned, failed lookup, checking off, `extensionLock`; verify `TheCheckListsThePackagesAndInstallsNothing`, `AnInstallThatInstallsNothingIsAFailure`, `AFailedLookupIsNotUpToDateInTheTerminal`, `LockedExtensionsAreNotUpdatedFromTheTerminal`, `CheckingOffLooksUpNoPackage` with injected steps
- [x] 1.4 Wire the `update` branch of `index.ts`: the server's agent directory and the command's project, `--extensions`, `--all`, and the hint after a plain update; verify `TheExtensionsAreUpdatedFromTheTerminal`, `AllUpdatesTheExtensionsEvenWhenPiOutpostIsRefused` and `APlainUpdateNamesTheExtensionsBehind` by running the real command against a real npm and a registry of the test's own

## 2. Docs and coverage

- [x] 2.1 Update `README.md` and `scripts/team-install/README.md`
- [x] 2.2 Write `scenario-coverage.md`; run `npm run check:scenarios` and `openspec validate update-pi-extensions-from-the-terminal --strict`
