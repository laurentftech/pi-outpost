# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`userGitConfig`, the policies' `readOnlyFiles`),
`server/src/confinedBash.ts` and `server/src/index.ts` (`terminalConfinement`). Scenarios enumerated
with `rg '^#### Scenario:' openspec/changes/git-global-ignore-readable`.

| Scenario | Status | Test file and name |
|---|---|---|
| GitAppliesTheGlobalIgnoreQuietly | covered | Real: `server/test/confinedBashMxcLinux.test.ts` (Bubblewrap, CI's `mxc-linux`) and `server/test/confinedBashMxcMac.test.ts` (Seatbelt through MXC, CI's `mxc-macos`): `GitAppliesTheGlobalIgnoreQuietly: …` — a `.gitconfig` naming a global ignore of `*.log`; `git status` prints no warning, lists `kept.txt` and not `debug.log`; another file of the home folder is neither listed nor read. Unit: `server/test/terminalSandbox.test.ts`: `GitAppliesTheGlobalIgnoreQuietly: the files .gitconfig names in [core] are readable too, existing ones only` — `[core]` only (any case, not `[core "sub"]`), quotes, `~/`, comments, CRLF, a missing file left out; in a policy the file is read-only and its folder absent. |
