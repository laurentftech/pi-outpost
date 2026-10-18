# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`runnerKind`, `checkRunner`, the MXC request
builders), `server/src/config.ts` (`resolveRunner`), `server/src/mxcExecutor.ts` and
`server/src/terminalManager.ts` (`shellUnder`). Scenarios enumerated with
`rg '^#### Scenario:' openspec/changes/mxc-macos-seatbelt`.

The real-executor tests run where `MXC_MAC_EXEC` names `mxc-exec-mac`: `scripts/mxc-macos/test.sh`,
which CI's `mxc-macos` job runs on `macos-latest` (Apple silicon) on every pull request. First green
run 2026-10-18: 6/6, none skipped.

| Scenario | Status | Test file and name |
|---|---|---|
| MxcNamesTheMacOsExecutor | covered | `server/test/mxcExecutor.test.ts`: `MxcNamesTheMacOsExecutor: on Apple silicon, the package's mxc-exec-mac; on an Intel Mac, none` — the lookup returns `bin/arm64/mxc-exec-mac`, and nothing for x64 even with a file planted in `bin/x64`. `server/test/terminalSandbox.test.ts`: `MxcNamesTheMacOsExecutor: a path ending in mxc-exec-mac is MXC, and only that name`. |
| OnAnIntelMacMxcIsRefused | covered | `server/test/mxcExecutor.test.ts`: `OnAnIntelMacMxcIsRefused: the reason names the architecture, not a missing install` — the exact message for darwin/x64, which `loadConfig` throws with the field's name (`server/test/config.test.ts`: `"mxc" names the executor pi-outpost ships…` asserts that throw on a platform or architecture without an executor). |
| OnMacOsACommandCannotReachOutsideTheRoot | covered | `server/test/confinedBashMxcMac.test.ts`: `OnMacOsACommandCannotReachOutsideTheRoot: …` — real executor: sibling and agent reads exit 1 with nothing of them in the output, the write in the root lands, the one beside it is refused (`beside=1`) and absent on the host, `kill -0` and `kill -TERM` on a `sleep` of the server's user exit 1 and the process is alive, no `OPENAI_API_KEY`. |
| OnMacOsGitAnswersQuietly | covered | `server/test/confinedBashMxcMac.test.ts`: `OnMacOsGitAnswersQuietly: …` — `git init`, `rev-parse` → `true`, `status` → `## …`; no `warning`, `error`, `xcrun` or `DARWIN_USER` in the output; the repository holds only `.git` and the root (HOME) gained nothing. Unit: `server/test/terminalSandbox.test.ts`: `the developer directory's git comes before Apple's xcrun shim on the search path`. |
| OnMacOsWithoutAnAllowlistTheNetworkIsOpen | covered | Real: `server/test/confinedBashMxcMac.test.ts`: `without allowedHosts the network is open` — example.com answers 200. Unit: `server/test/terminalSandbox.test.ts`: `OnMacOsWithoutAnAllowlistTheNetworkIsOpen: …` — `network` is `egress: allow`, no `runtimeConfig`. |
| OnMacOsAnAllowedHostIsReachedAndOthersAreRefused | covered | `server/test/confinedBashMxcMac.test.ts`: `OnMacOsAnAllowedHostIsReachedAndOthersAreRefused: …` — real executor and the server's proxy: `allowed=200`, non-zero exits for the unlisted host and for `--noproxy`, no body from another loopback service, the refusal note ending the output, `registry.npmjs.org:443` in the proxy's relayed list. |
| OnMacOsWithMxcGitRunsInTheTerminal | covered | `server/test/terminalSandboxMxcMac.test.ts`: `OnMacOsWithMxcGitRunsInTheTerminal: …` — a real pty through `TerminalManager` and `mxc-exec-mac`: `git rev-parse` and `git status`, the agent's key file unreadable (`exit=1`), no server key in `env`. |
| OnMacOsTheConfinedTerminalBehavesAsATerminal | covered | `server/test/terminalSandboxMxcMac.test.ts`: `OnMacOsTheConfinedTerminalBehavesAsATerminal: …` — `stty size` 40 120, then 50 150 after a resize; `sleep 30` interrupted by Ctrl-C with status 130 and the shell alive; `getCwd` after `cd sub` returns the real path of `sub`. |
