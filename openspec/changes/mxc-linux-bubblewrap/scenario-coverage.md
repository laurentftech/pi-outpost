# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`runnerKind`, `checkRunner`, the MXC request
builders), `server/src/config.ts` (`resolveRunner`) and `server/src/mxcExecutor.ts`. Scenarios
enumerated with `rg '^#### Scenario:' openspec/changes/mxc-linux-bubblewrap`.

The real-executor tests run in Docker with `bash scripts/mxc-linux/test.sh`, which CI's `mxc-linux` job
runs on every pull request. First run 2026-10-18 on macOS (OrbStack, kernel 7.2.9, x64,
MXC 1.0.1): default profile 1/1, documented flags 6/6.

| Scenario | Status | Test file and name |
|---|---|---|
| MxcNamesTheLinuxExecutor | covered | `server/test/mxcExecutor.test.ts`: `MxcNamesTheLinuxExecutor: on Linux, the package's lxc-exec for this architecture` — the lookup returns `bin/x64/lxc-exec` and `bin/arm64/lxc-exec` per arch, beside a Windows executor that is not chosen. `server/test/terminalSandbox.test.ts`: `MxcNamesTheLinuxExecutor: a path ending in lxc-exec is MXC on Linux, and only that name`. |
| OnLinuxACommandCannotReadOutsideTheRoot | covered | `server/test/confinedBashMxcLinux.test.ts`: `OnLinuxACommandCannotReadOutsideTheRoot: …` — real executor: sibling and agent reads exit 1 with nothing of them in the output, the write in the root lands on the host and the one beside it does not (checked on the host: Bubblewrap's private tmpfs may accept it and discard it), `node-visible=0`, `key-visible=0`, no `OPENAI_API_KEY`, `git rev-parse` → `true`. |
| AContainerWithoutNamespacesRefusesWithTheReason | covered | Real: `server/test/confinedBashMxcLinux.test.ts` under `MXC_LINUX_EXPECT=refused` (Docker's default profile) — `AContainerWithoutNamespacesRefusesWithTheReason: …`: the check fails naming namespaces, the command is refused with it and leaves no file. Unit: `server/test/terminalSandbox.test.ts`: MXC's message, read from its error object, is the reason verbatim. |
| OnLinuxAnAllowedHostIsReachedAndOthersAreRefused | covered | `server/test/confinedBashMxcLinux.test.ts`: `OnLinuxAnAllowedHostIsReachedAndOthersAreRefused: …` — real executor and the server's proxy: `allowed=200`, non-zero exits for the unlisted host and for `--noproxy`, no body from another service on the container's loopback, the refusal note ending the output, and `registry.npmjs.org:443` in the proxy's relayed list. |
| OnLinuxWithoutAnAllowlistTheNetworkIsOpen | covered | `server/test/terminalSandbox.test.ts`: `OnLinuxWithoutAnAllowlistTheNetworkIsOpen: …` — `network` is `{ egress: { default: "allow" } }` and `runtimeConfig` absent. Real: `server/test/confinedBashMxcLinux.test.ts`: `without allowedHosts the network is open` — `example.com` answers 200. |
| OnLinuxWithMxcGitRunsInTheTerminal | covered | `server/test/terminalSandboxMxcLinux.test.ts`: `OnLinuxWithMxcGitRunsInTheTerminal: …` — a real pty through `TerminalManager` and `lxc-exec`: `git rev-parse` and `git status`, the agent directory's key file unreadable (`exit=1`), no server key in `env`; also size and resize, and `getCwd` after `cd sub`. |

## Running app

2026-10-18, the server in the test image with the documented flags, `bashRunner` and `terminal.sandbox`
`"mxc"`, `allowedHosts: ["registry.npmjs.org"]`, Mistral's codestral driving the agent from the web UI
(Playwright). Read back from the session transcript: the agent's one bash call got `npm=200`,
`example=000` with the refusal note, both reads beside the root (a file beside it, a file in the agent
directory) "No such file or directory", and its write in the root landed. The terminal panel: badge
naming the root, `git status` answered, the agent directory unreadable, 6 processes visible, Ctrl-C
interrupted `sleep` (130), `exit` ended the tab, three rapid new tabs opened, and disconnecting the page
left no live runner process. It also showed closed terminals leaving zombie `bwrap`s under Node as PID 1:
`docker run --init` is now in the documented command (`scripts/probes/mxc-linux-zombies.mjs`).
