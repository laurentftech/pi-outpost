# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`runnerKind`, `checkRunner`, the MXC request
builders), `server/src/config.ts` (`resolveRunner`) and `server/src/mxcExecutor.ts`. Scenarios
enumerated with `rg '^#### Scenario:' openspec/changes/mxc-linux-bubblewrap`.

**Not complete.** The real-executor tests have not run yet (see `HANDOVER.md`): the scenarios they
carry are `uncovered` until `scripts/mxc-linux/test.sh` passes, and `npm run check:scenarios` fails
on this change until then — on purpose.

| Scenario | Status | Test file and name |
|---|---|---|
| MxcNamesTheLinuxExecutor | covered | `server/test/mxcExecutor.test.ts`: `MxcNamesTheLinuxExecutor: on Linux, the package's lxc-exec for this architecture` — the lookup returns `bin/x64/lxc-exec` and `bin/arm64/lxc-exec` per arch, beside a Windows executor that is not chosen. `server/test/terminalSandbox.test.ts`: `MxcNamesTheLinuxExecutor: a path ending in lxc-exec is MXC on Linux, and only that name`. |
| OnLinuxACommandCannotReadOutsideTheRoot | uncovered | `server/test/confinedBashMxcLinux.test.ts`: `OnLinuxACommandCannotReadOutsideTheRoot: …` — written, not yet run. Asserts sibling and agent reads fail with nothing of them in the output, the write lands only in the root, `node-visible=0`, `key-visible=0`, no `OPENAI_API_KEY`, `git rev-parse` → `true`. |
| AContainerWithoutNamespacesRefusesWithTheReason | partial | Unit: `server/test/terminalSandbox.test.ts`: `AContainerWithoutNamespacesRefusesWithTheReason: …` — MXC's message, read from its error object, is the reason verbatim. Real (not yet run): `server/test/confinedBashMxcLinux.test.ts` under `MXC_LINUX_EXPECT=refused` — the check fails naming namespaces, the command is refused and leaves no file. |
| OnLinuxAnAllowedHostIsReachedAndOthersAreRefused | uncovered | `server/test/confinedBashMxcLinux.test.ts`: `OnLinuxAnAllowedHostIsReachedAndOthersAreRefused: …` — written, not yet run. Asserts `allowed=200`, non-zero exits for the unlisted host and for `--noproxy`, no body from another loopback service, the refusal note ending the output, and the allowed host in the proxy's relayed list. |
| OnLinuxWithoutAnAllowlistTheNetworkIsOpen | covered | `server/test/terminalSandbox.test.ts`: `OnLinuxWithoutAnAllowlistTheNetworkIsOpen: …` — `network` is `{ egress: { default: "allow" } }` and `runtimeConfig` absent; the proxy shape is checked by `under allowedHosts: outbound and inbound denied, the proxy the only way out`. Real (not yet run): `without allowedHosts the network is open`. |
| OnLinuxWithMxcGitRunsInTheTerminal | uncovered | `server/test/terminalSandboxMxcLinux.test.ts`: `OnLinuxWithMxcGitRunsInTheTerminal: …` — written, not yet run: a real pty through `TerminalManager`, `git rev-parse` and `git status`, the agent's `auth.json` unreadable, no server key in `env`; also size and resize, and `getCwd` after `cd sub`. |
