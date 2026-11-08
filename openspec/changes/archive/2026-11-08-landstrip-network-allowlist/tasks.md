# Tasks

## 1. Prerequisites

- [x] 1.1 Archive `host-questions-on-posix-runners`, then `add-docker-python-deployment` (moving its post-release check to the release notes if it has not run yet). Verify that `openspec/specs/sandbox-approved-grants/spec.md` contains `AnotherCommandsProxyIsNoWayOut` and that `openspec/specs/docker-python-deployment/spec.md` contains `OperatorControlledNetwork`.
- [x] 1.2 Move CI's Linux job and the Docker image to landstrip 0.20.26, the version the user chose (extracted AppImage; `kernel.apparmor_restrict_unprivileged_userns=0` on the runner, as in `mxc-linux`). Verify that the Linux job's `landstrip doctor` prints `"ok":true`.

## 2. landstrip policy under a proxy

- [x] 2.1 Extract the proxy variable list (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and lower case) from `seatbeltPolicy` into a shared function, used by Seatbelt unchanged. Verify that `terminalSandboxSeatbelt.test.ts` passes.
- [x] 2.2 `terminalPolicy` (Linux) takes `networkProxy`: `network: { allowNetwork: false, allowLocalBinding: false, httpProxyPort }`, and `{ allowNetwork: true }` without it; on Windows a proxy is refused. Verify with tests in `landstripNetworkPolicy.test.ts`: the port comes from the URL, `socksProxyPort` and Unix sockets stay absent, and the Windows policy is unchanged.
- [x] 2.3 `confinedBash.ts`: the landstrip branch passes `networkProxy` and sets the proxy variables in the command's environment. Verify with a unit test of the written policy and environment (dedicated proxy port when `askHost`, shared otherwise).
- [x] 2.4 `config.ts`: accept `sandbox.allowedHosts` with landstrip on Linux, refuse it on Windows with a message naming MXC. Verify `AnAllowlistNeedsMxcWithoutAnImage` and `AnAllowlistIsKeptUnderLandstripOnLinux` in `config.test.ts`, with the platform injected and paths built with `path`.
- [x] 2.5 `egressProxy.ts` holds its port on `[::1]` as well as `127.0.0.1`, serving both, and gives up a port taken on `[::1]` (landstrip opens the proxy's number on every loopback address). Verify the two `egressProxy.test.ts` tests (`EADDRINUSE` for a squatter on `[::1]`, the proxy answering there, and no shared number with a block of `[::1]` listeners).
- [x] 2.6 Draft the landstrip enhancement request (proxy ports bound to an address) with the 0.20.26 reproduction in `scripts/probes/upstream/landstrip-proxy-port-address.md`; filing it upstream is left to the user.

## 3. Real proof and admission into host questions

- [x] 3.1 Real network test under landstrip (`LANDSTRIP_BIN`, Linux): `UnderLandstripWithoutAnAllowlistTheNetworkIsOpen`, `UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused`, `UnderLandstripNoOtherLoopbackAddressReachesAService` (`127.0.0.1`, another `127.x`, `::1`, a listener, and a Unix socket in the temporary directory). Verify that it passes in CI's Linux job and that a deliberately opened `allowLocalBinding` makes it fail.
- [x] 3.2 Add landstrip to the `another session's proxy` check in `sandboxGrantsReal.test.ts` (`AnotherCommandsProxyIsNoWayOut`). Verify `other=000` in CI's Linux job.
- [x] 3.3 In the same commit as 3.2: `hostGrantsRefusal` admits landstrip on Linux only. Verify that `APosixRunnerAsksAboutAnUnlistedHost` and `APosixRunnerAppliesARefusal` run under landstrip in `sandboxGrantsReal.test.ts`, and that `AnUnprovenRunnerAsksNothingAboutHosts` still covers landstrip on Windows in `sandboxGrants.test.ts`.
- [x] 3.4 `docs/sandboxing.md`: Linux section (landstrip and `allowedHosts`, example), the "Recommended setup" sentence, the grants table (line "landstrip"), the limits (tools that ignore the proxy), and the stale `allowedHosts` paragraph: an empty list asks about every host when grants are on, and the key is no longer MXC-only. Verify the anchors and the documented JSON (`JSON.parse`).

## 4. Docker: default and total refusal

- [x] 4.1 `bootstrap.mjs` and `compose.yml`: three modes (unset, `1`, `0`), anything else refused naming the values and the default, mode logged, and under the default `allowedHosts: []` added to a configuration that lacks it, fresh or existing, and given up (network closed, logged) when the installed pi-outpost refuses it. The template `config.json` keeps no key. Verify `AnInvalidNetworkChoiceIsRefused` and `AnExistingConfigurationIsAskedAboutToo` in `deploy/docker/test.mjs`.
- [x] 4.2 `landstrip.cjs`: default → `allowNetwork`/`allowLocalBinding` forced to `false`, proxy port kept; `0` → also remove `httpProxyPort` and `socksProxyPort`; `1` → forward unchanged. Verify `AgentNetworkNeedsOperatorOptIn` (an open policy without a proxy port still refused), `AnOperatorRefusalClosesTheNetworkEntirely` (Python connect to a listening proxy port refused) and `HonorsAnExplicitNetworkRefusal`.
- [x] 4.3 `deploy/docker/test.mjs`: `TheAgentIsAskedAboutEveryHostByDefault` (the key in a fresh volume, the app confined, the proxy port alone open through the ceiling; the question itself is `sandboxGrantsReal.test.ts` under landstrip, since the image has no model) and `AnOperatorOptInFollowsTheConfiguration` are added; `AgentNetworkNeedsOperatorOptIn` keeps its annotation. `docker-python.yml` builds the image from the branch's CLI. Verify locally (WSL Docker) and in the `docker-python.yml` job.
- [x] 4.4 `docs/docker.md` (network section, Python downloads, web app) and the release notes (in the PR description, for the release's changelog): questions by default, how to list hosts in `/data/config.json`, `ALLOW_AGENT_NETWORK=1` for the configuration as is, `0` for the total refusal, and the key added to an existing volume on upgrade. Verify that the documented commands match `compose.yml`.

## 5. Integration

- [x] 5.1 Write `scenario-coverage.md` (every scenario of the three deltas, `rg '^#### Scenario:' openspec/changes/landstrip-network-allowlist`), assertions reread. Verify that `npm run check:scenarios` and `openspec validate landstrip-network-allowlist --strict` pass.
- [x] 5.2 Running app in the Docker image: with `allowedHosts`, ask the agent for a `pip download` from a listed host and then from an unlisted one, answer the question, and read the transcript back (note, grant, lock). Repeat with `ALLOW_AGENT_NETWORK=0` and with rapid commands mid-question. Report what breaks. Done 2026-11-08 in the branch image under WSL Docker: pypi.org and files.pythonhosted.org asked about with the command, approved once, both audit lines logged, the wheels in the workspace. Found: landstrip's `NETWORK_DENIED` info lines reach the agent raw and misled it (a harmless `bind` during `python3 -m venv`); the startup line says "network only to nothing" for an empty list. Both left to a follow-up PR.

## Workflow follow-up

- Archive the change after review and a green CI on the Linux and Docker jobs.
