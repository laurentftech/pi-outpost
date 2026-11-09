# Scenario coverage — landstrip-network-allowlist

The runner is real wherever confinement is the point. landstrip 0.20.26 runs in CI's Linux job
(`LANDSTRIP_BIN`, `.github/workflows/ci.yml`) and in the Docker image (`deploy/docker/test.mjs`,
`docker-python.yml`, which builds the image from the branch's CLI). Locally, every real-runner test
below passed under landstrip 0.20.26 on Ubuntu 24.04 (WSL2, kernel 6.18), and the Docker test passed
with WSL's Docker. One exception: `UnderLandstripWithoutAnAllowlistTheNetworkIsOpen` cannot resolve
names there, because WSL's `/etc/resolv.conf` points into `/mnt/wsl`, outside the readable trees. On
the GitHub runner it points into `/run/systemd/resolve`, which is readable.

Mutation check: with `allowLocalBinding: true` written into the proxy policy,
`UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused` and
`UnderLandstripNoOtherLoopbackAddressReachesAService` both fail ("a service of the host was reached").

## Capability: `sandbox-runner-bash` (5 scenarios, modified)

| Scenario | Status | Evidence |
| --- | --- | --- |
| AnAllowlistNeedsMxcWithoutAnImage | covered | `server/test/config.test.ts` — "AnAllowlistNeedsMxcWithoutAnImage: …". No runner, landstrip off Linux and `bashImage` are refused with `"sandbox.allowedHosts" needs MXC, Seatbelt, or landstrip on Linux …`; Windows and Linux CI each run their half. Also "\"auto\" holds the network for allowedHosts; \"none\" cannot…" |
| AnAllowlistIsKeptUnderLandstripOnLinux | covered | `server/test/config.test.ts` — "AnAllowlistIsKeptUnderLandstripOnLinux: …". On Linux, `Registry.npmjs.org` is kept lower-cased and the runner path resolved with `path.join`; elsewhere it is refused. `server/test/landstripNetworkPolicy.test.ts` — "on Windows a proxy is refused…" (the policy itself refuses one) |
| UnderLandstripWithoutAnAllowlistTheNetworkIsOpen | covered | `server/test/confinedNetworkLandstrip.test.ts` — "UnderLandstripWithoutAnAllowlistTheNetworkIsOpen: …": `open=200` from a public host and `proxies=0` in the command's environment. `server/test/landstripNetworkPolicy.test.ts` — "without a proxy the network stays open, as before"; `server/test/confinedBash.test.ts` — "under a proxy, landstrip's policy holds the network…" (no list: `{ allowNetwork: true }`, no `HTTPS_PROXY`) |
| UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused | covered | `server/test/confinedNetworkLandstrip.test.ts` — "UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused: …": `allowed=200`, non-zero `unlisted`, `direct` (`--noproxy`) and `loopback`, no `svc-127-0-0-1`, the output ending with the note naming `example.com`, and `registry.npmjs.org:443` relayed by the proxy. The written policy and the variables: `server/test/confinedBash.test.ts` — "under a proxy, landstrip's policy holds the network to its port and the command is told where it is" (shared port, dedicated port with `askHost`); `server/test/landstripNetworkPolicy.test.ts` (`{ allowNetwork: false, allowLocalBinding: false, httpProxyPort }`, six proxy variables) |
| UnderLandstripNoOtherLoopbackAddressReachesAService | covered | `server/test/confinedNetworkLandstrip.test.ts` — "UnderLandstripNoOtherLoopbackAddressReachesAService: …". One port number, other than the proxy's, is served on `127.0.0.1`, `127.0.0.2` and `[::1]`, with a Unix socket in the root. Every connect exits non-zero with no `svc-` body, a `listen` is refused, and the proxy's own number on `[::1]` answers `403` from the proxy itself. `server/test/egressProxy.test.ts` — "holds its port on [::1] as well, and answers there" (`EADDRINUSE` for a squatter) and "gives up a port already taken on [::1] for one free on both" |

## Capability: `sandbox-approved-grants` (7 scenarios, modified)

| Scenario | Status | Evidence |
| --- | --- | --- |
| ADirectoryBesideTheRootIsWritableUnderEachRunner | covered | Unchanged: `server/test/sandboxGrantsReal.test.ts` — "grants under landstrip" (and the other runners): the granted command writes beside the root, the next one without the grant is refused (passed under landstrip 0.20.26 locally) |
| AReadGrantDoesNotWrite | covered | Unchanged: `server/test/sandboxGrantsReal.test.ts` — "grants under …": the read-only directory is read and its write refused |
| WslcRefusesADirectoryGrant | covered | Unchanged: `server/test/sandboxGrants.test.ts` — "WslcRefusesADirectoryGrant: …" |
| AnUnprovenRunnerAsksNothingAboutHosts | covered | `server/test/sandboxGrants.test.ts` — "an unlisted host is asked about only under a runner shown to keep a command off other proxies": landstrip on Linux is admitted. landstrip on Windows, a `landstrip.exe` path on Windows, and an unknown runner on Linux and Windows get `not yet proven under … reach no other proxy` (the unknown runner on Linux is the case `runnerKind` would have called landstrip). "AnUnprovenRunnerAsksNothingAboutHosts: …": `asksAboutHosts` is true for landstrip only on Linux, and false for an unknown runner, `grants: "never"` and no list |
| APosixRunnerAsksAboutAnUnlistedHost | covered | `server/test/sandboxGrantsReal.test.ts` — "APosixRunnerAsksAboutAnUnlistedHost: …" under landstrip: `first=200`, `second=200`, `askHost` called once with `example.com`, the allow note. `server/test/sandboxHostQuestionServer.test.mjs` — "the server asks about an unlisted host under landstrip, …": the client receives a `connection` request for `example.com` and the `curl` command, then `fetched=200`, the allow note and the `[sandbox] grant approved once` audit line |
| APosixRunnerAppliesARefusal | covered | `server/test/sandboxGrantsReal.test.ts` — "APosixRunnerAppliesARefusal: …" under landstrip: no 200, asked once, the refusal and do-not-retry notes. `server/test/sandboxHostQuestionServer.test.mjs` — "a refusal through the server leaves the connection refused under landstrip": no 200, the refusal note, `[sandbox] grant refused` |
| AnotherCommandsProxyIsNoWayOut | covered | `server/test/sandboxGrantsReal.test.ts` — "another session's proxy under landstrip": "a command reaches its own proxy, and the port of another is closed to it" (`own=403`, `other=000`) |

## Capability: `docker-python-deployment` (7 scenarios, modified)

| Scenario | Status | Evidence |
| --- | --- | --- |
| TheAgentIsAskedAboutEveryHostByDefault | covered | `deploy/docker/test.mjs` — "TheAgentIsAskedAboutEveryHostByDefault": the recorded network choice says `ask`, a fresh volume's configuration holds `sandbox.allowedHosts: []` with no `grants` key, the startup log shows both surfaces confined, and through the adapter a proxy-only policy reaches `PROXY_OK` while another loopback port is refused. The question itself, answered both ways under landstrip: `server/test/sandboxHostQuestionServer.test.mjs` and `server/test/sandboxGrantsReal.test.ts` (above) |
| AnExistingConfigurationIsAskedAboutToo | covered | `deploy/docker/test.mjs` — "AnExistingConfigurationIsAskedAboutToo": the key is removed from the configuration, the container is recreated, the key comes back as `[]`, and the app starts confined |
| AgentNetworkNeedsOperatorOptIn | covered | `deploy/docker/test.mjs` — "AgentNetworkNeedsOperatorOptIn": under the default, `networkMustBeRefused({ allowNetwork: true })` (Python bind and connect raise `PermissionError`), and an open policy does not reach a loopback listener |
| AnOperatorOptInFollowsTheConfiguration | covered | `deploy/docker/test.mjs` — "AnOperatorOptInFollowsTheConfiguration": under `1`, the recorded network choice says `config`, a configuration without the key is left without it, and an open policy reaches the loopback listener (`OTHER_SERVICE`) |
| AnOperatorRefusalClosesTheNetworkEntirely | covered | `deploy/docker/test.mjs` — "AnOperatorRefusalClosesTheNetworkEntirely": under `0`, the recorded network choice says `none`, an open policy's bind and connect are refused, and a proxy-only policy cannot reach the listening proxy port (`PermissionError`, no `PROXY_OK`) |
| HonorsAnExplicitNetworkRefusal | covered | Unchanged: `deploy/docker/test.mjs` — "HonorsAnExplicitNetworkRefusal": under the opt-in, a caller policy denying networking stays denied |
| AnInvalidNetworkChoiceIsRefused | covered | `deploy/docker/test.mjs` — "AnInvalidNetworkChoiceIsRefused": `OUTPOST_ALLOW_AGENT_NETWORK=yes` stops the container with the message naming unset, `1` and `0` |
