# Scenario coverage — host-questions-on-posix-runners

The runners are real wherever confinement is the point: `server/test/sandboxGrantsReal.test.ts` and
`server/test/sandboxHostQuestionServer.test.mjs` run under Seatbelt and MXC on macOS in CI's `mxc-macos`
job (`scripts/mxc-macos/test.sh`) and under MXC on Linux in `mxc-linux` (`scripts/mxc-linux/Dockerfile`,
the documented Docker flags). Locally they passed under Seatbelt on this Mac and under Bubblewrap in the
Debian image and in Rocky Linux 9 (`scripts/probes/mxc-linux-rocky/Dockerfile`). MXC on macOS needs
Apple silicon and is covered by CI only. The flow was also driven in the running widget under Seatbelt and
under Bubblewrap in the Rocky 9 container (`scripts/probes/mxc-linux-rocky/serve-host-questions.sh`).

## Capability: `sandbox-approved-grants` (7 scenarios, modified)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ADirectoryBesideTheRootIsWritableUnderEachRunner | covered | Unchanged: `server/test/sandboxGrantsReal.test.ts` — "grants under …": "the granted command reads both, writes where it may only", "the next command, without the grant, reaches neither" (re-run under Seatbelt, Debian and Rocky 9) |
| AReadGrantDoesNotWrite | covered | Unchanged: `server/test/sandboxGrantsReal.test.ts` — "grants under …": the read-only directory is read and its write refused |
| WslcRefusesADirectoryGrant | covered | Unchanged: `server/test/sandboxGrants.test.ts` — the WSLC refusal of a directory grant |
| AnUnprovenRunnerAsksNothingAboutHosts | covered | `server/test/sandboxGrants.test.ts` — "an unlisted host is asked about only under a runner shown to keep a command off other proxies": landstrip and an unknown runner get `not yet proven under … reach no other proxy`; and the `asksAboutHosts` test: landstrip never asks, `grants: "never"` and no list never ask |
| APosixRunnerAsksAboutAnUnlistedHost | covered | `server/test/sandboxGrantsReal.test.ts` — "APosixRunnerAsksAboutAnUnlistedHost: …" under MXC on Linux, MXC on macOS and Seatbelt: two connections both 200, `askHost` called once with `example.com`, the output ends with the allow note; `server/test/sandboxHostQuestionServer.test.mjs` — "the server asks about an unlisted host under …": the client receives a `connection` request naming `example.com` and the `curl` command, approving it yields `fetched=200`, the allow note, and the `[sandbox] grant approved once` audit line (fails with the old gate: no request arrives) |
| APosixRunnerAppliesARefusal | covered | `server/test/sandboxGrantsReal.test.ts` — "APosixRunnerAppliesARefusal: …": no 200, asked once, the refusal and do-not-retry notes; `server/test/sandboxHostQuestionServer.test.mjs` — "a refusal through the server leaves the connection refused…": no 200, the refusal note, the `[sandbox] grant refused` audit line |
| AnotherCommandsProxyIsNoWayOut | covered | `server/test/sandboxGrantsReal.test.ts` — "another session's proxy under …": "a command reaches its own proxy, and the port of another is closed to it" (`own=403`, `other=000`) under MXC on Linux, MXC on macOS and Seatbelt; MXC on Windows keeps `server/test/confinedNetworkMxc.test.ts` "another command's proxy is not a way out" |
