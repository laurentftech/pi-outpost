# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/git-repo-config-runs-nothing/` (1 scenario, `git`).

| Scenario | Status | Evidence |
| --- | --- | --- |
| ARepositorysConfigurationRunsNothingInTheServer | covered | `server/test/gitRepoConfigEscape.test.ts`: for each of `core.fsmonitor`, `diff.trap.textconv`, `diff.trap.command`, `diff.external`, `filter.trap.clean` and `filter.trap.process`, a repository whose `.gitattributes` assigns the driver, with a tracked file changed at the same size and a later time, goes through every git call the server makes (`gitStatusFor`, `gitLog`, `gitFileLog`, `gitShow`, `gitHeadContent`, `gitRevisionContent`); the command would write a marker, and the test asserts there is none. "an included configuration file is held to the same" does it through `include.path`. "a confined command writes core.fsmonitor; the server's status does not run it outside the root" runs under MXC's real executor (`MXC_EXEC`, Windows): the confined command is shown unable to write outside its root, shown to have written `core.fsmonitor` (read back with git), then every server call runs and no marker appears outside the root. Without the fix, 6 of the 8 fail (`core.fsmonitor`, `textconv`, filter `clean` and `process`, the include, and the MXC path): the assertions reach the real boundary. |
