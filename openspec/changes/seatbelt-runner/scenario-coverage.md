# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`runnerKind`, `checkRunner`, `mxcMacConfig`),
`server/src/config.ts` (`resolveRunner`, the `allowedHosts` check), `server/src/confinedBash.ts` and
`server/src/terminalManager.ts`. Scenarios enumerated with
`rg '^#### Scenario:' openspec/changes/seatbelt-runner`.

The real tests run where `SEATBELT_EXEC` names `sandbox-exec`, on macOS: `scripts/mxc-macos/test.sh`
runs them on every Mac, and CI's `mxc-macos` job on `macos-latest`. First green run 2026-10-18 on the
developer's Intel iMac (macOS 15.8, x86_64): 7/7, none skipped.

| Scenario | Status | Test file and name |
|---|---|---|
| SeatbeltNamesTheSystemRunner | covered | `server/test/config.test.ts`: `SeatbeltNamesTheSystemRunner: …` — on macOS `"seatbelt"` resolves to `/usr/bin/sandbox-exec` for `bashRunner` and `terminal.sandbox` and keeps `allowedHosts`; elsewhere loading fails naming macOS; a `sandbox-exec` path keeps `allowedHosts` and refuses an image. `server/test/terminalSandbox.test.ts`: `SeatbeltNamesTheSystemRunner: sandbox-exec is the seatbelt kind; …` — the kind, the check's `-f <profile> /usr/bin/true`, the reason on refusal, and refusal off macOS. |
| UnderSeatbeltACommandCannotReachOutsideTheRoot | covered | `server/test/confinedBashSeatbelt.test.ts`: `UnderSeatbeltACommandCannotReachOutsideTheRoot: …` — real `sandbox-exec`: sibling and agent reads exit 1 with nothing of them in the output, the write in the root lands, the one beside it is refused and absent on the host, `kill -0`/`kill -TERM` on a `sleep` of the server's user exit 1 and it lives, no `OPENAI_API_KEY`. |
| UnderSeatbeltGitAnswersQuietly | covered | `server/test/confinedBashSeatbelt.test.ts`: `UnderSeatbeltGitAnswersQuietly: …` — `init`, `rev-parse`, `status`; no `warning`, `error`, `xcrun` or `DARWIN_USER`; only `.git` in the repository and nothing new in the root. Unit: `server/test/terminalSandbox.test.ts`: `MXC's shape: …` asserts the developer tools' git first on the command's `PATH`. |
| UnderSeatbeltWithoutAnAllowlistTheNetworkIsOpen | covered | `server/test/confinedBashSeatbelt.test.ts`: `UnderSeatbeltWithoutAnAllowlistTheNetworkIsOpen: …` — example.com 200, a server on the loopback unreached (non-zero curl, no body). Unit: `MXC's shape: …` — `(allow network-outbound)` and `(deny network-outbound (remote ip "localhost:*"))`. |
| UnderSeatbeltAnAllowedHostIsReachedAndOthersAreRefused | covered | `server/test/confinedBashSeatbelt.test.ts`: `UnderSeatbeltAnAllowedHostIsReachedAndOthersAreRefused: …` — `allowed=200`, non-zero exits for the unlisted host and `--noproxy`, no loopback body, the refusal note last, `registry.npmjs.org:443` relayed by the proxy. Unit: `under allowedHosts: the proxy's port alone, and the proxy's variables set for the command`. |
| UnderSeatbeltGitRunsInTheTerminal | covered | `server/test/terminalSandboxSeatbelt.test.ts`: `UnderSeatbeltGitRunsInTheTerminal: git answers, the agent's keys cannot be read` (a real pty, bash) and `UnderSeatbeltGitRunsInTheTerminal: in zsh, git is the developer tools' own, quiet, and leaves nothing in the root` (zsh started as pi-outpost starts it). |
| UnderSeatbeltTheConfinedTerminalBehavesAsATerminal | covered | `server/test/terminalSandboxSeatbelt.test.ts`: `UnderSeatbeltTheConfinedTerminalBehavesAsATerminal: …` — 40 120, then 50 150 after a resize; Ctrl-C ends `sleep` with 130 and the shell lives; `getCwd` after `cd sub` is `sub`'s real path (the pty's own process, the shell after `sandbox-exec`'s exec). |

## Running app

2026-10-18, on the developer's Intel iMac: pi-outpost from this branch with `bashRunner` and
`terminal.sandbox` `"seatbelt"`, `allowedHosts: ["registry.npmjs.org"]`, Mistral's codestral, driven
through the web UI with Playwright; the session transcript read back. The agent's one bash call: npm
200, example.com refused with the note, a file beside the root and one in the agent directory
"Operation not permitted", its write in the root landed. The terminal (zsh, the badge naming the root):
git is Xcode's own, the agent directory and a write beside the root refused, `cd` and `pwd`; Ctrl-C 130,
`exit`, three quick new tabs; after the page disconnects, no shell under the server and no zombie.

Found there, outside this change: the user's `~/.gitconfig` names `core.excludesfile` in the home
folder, which no runner opens (only `~/.gitconfig` itself is readable), so git warns "unable to access
…/.gitignore_global" on every call under every runner. Reported as a follow-up.
