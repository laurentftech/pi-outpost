# Proposal

## Why

On Linux, landstrip is the recommended runner, Docker included, yet `sandbox.allowedHosts` is refused
with it. The agent's network there is all or nothing: open everywhere, or, in the Docker image by
default, closed entirely. landstrip has no such limit. Its policy can close the network
(`allowNetwork: false`) except for loopback TCP to declared proxy ports (`httpProxyPort`), enforced by
its seccomp supervisor. That has been the case since at least 0.19.8; this change moves CI and the
Docker image to 0.20.26. So the
server's existing egress proxy, per-command proxies and host questions can hold a landstrip shell to
named hosts exactly as they do under MXC and Seatbelt.

## What Changes

- With landstrip on Linux as `sandbox.bashRunner`, `sandbox.allowedHosts` is accepted. Each command's
  policy closes the network, leaves only its proxy's port open, and gets the proxy variables
  (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and their lower-case forms), as under Seatbelt. landstrip
  does not set them itself.
- The behaviour is the one already specified for the other runners: listed hosts go through the proxy,
  others are refused with the note, the proxy cannot be bypassed, and nothing else on the loopback is
  reachable.
- landstrip on Linux joins the runners whose commands may ask the user about an unlisted host, once a
  CI job with the real runner shows a command reaches its own proxy and no other loopback port.
- landstrip on Windows keeps refusing `sandbox.allowedHosts`: MXC is the Windows runner.
- **BREAKING (Docker image)**: by default the agent's network is no longer closed. It asks. At startup
  the bootstrap adds `"sandbox.allowedHosts": []` to `/data/config.json` when it is missing, on a fresh
  volume as on an existing one, unless the installed pi-outpost is too old to accept it. Every host the agent's shell connects to is then asked about in the
  interface: for this command, for the session, or refused. With `ALLOW_AGENT_NETWORK` unset, the
  adapter lets the proxy port through and still closes any policy without one, so an upgrade never
  opens the network.
  - `ALLOW_AGENT_NETWORK=1`: the generated policy unchanged, so an open network when the operator
    removes the key.
  - `ALLOW_AGENT_NETWORK=0`: a total refusal, with no IP networking and no proxy port.
  - The operator may also list hosts in `/data/config.json`.
- The terminal panel is not affected by `sandbox.allowedHosts`, as under every runner. In Docker its
  policy has no proxy, so it stays closed by default and with `0`, and follows the configuration with
  `1`, as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-runner-bash`: `AnAllowlistNeedsMxcWithoutAnImage` also accepts landstrip on Linux. New
  requirement: under landstrip on Linux, the network follows `sandbox.allowedHosts`.
- `sandbox-approved-grants`: `EachRunnerAppliesAGrantOrSaysItCannot` lists landstrip on Linux among the
  runners that may ask about a host, and `AnotherCommandsProxyIsNoWayOut` covers it.
- `docker-python-deployment`: `OperatorControlledNetwork`. By default the agent's shell asks about
  every host, and a policy without a proxy is closed. `1` follows the configuration, and `0` is a total
  refusal, proxy included.

## Impact

- Code: `server/src/config.ts` (the refusal), `server/src/terminalSandbox.ts` (landstrip's Linux
  policy and its network section), `server/src/confinedBash.ts` (passing the proxy to landstrip),
  `server/src/sandboxGrants.ts` (`hostGrantsRefusal`). The proxy variables are shared with Seatbelt.
- Docker: `deploy/docker/landstrip.cjs` (the ceiling
  also strips proxy ports), `bootstrap.mjs` and `compose.yml` (the default, landstrip 0.20.26), `deploy/docker/test.mjs`, and `docker-python.yml`, which builds the image from the branch's CLI.
  The bootstrap adds `allowedHosts: []` to an existing `/data/config.json` that lacks it, unless the
  operator chose `1`.
- Tests: `server/test/sandboxGrantsReal.test.ts` (landstrip added to the proxy-isolation check), a
  real-runner network test in CI's Linux job, and config, policy and Docker tests.
- Docs: `docs/sandboxing.md` (Linux section, recommended setup, the grants table), `docs/docker.md`
  (network section, `ALLOW_AGENT_NETWORK`), the release notes for the Docker default.
- Ordering: `host-questions-on-posix-runners` and `add-docker-python-deployment` hold the current text
  of two of these requirements and are not archived. They are archived first, so the deltas here apply
  to main specs that contain them.
