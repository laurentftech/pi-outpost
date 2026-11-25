# Proposal

## Why

Issue #570: on an air-gapped corporate machine, `uv` inside the sandbox cannot install anything. pip, npm
and Maven get the company Nexus because their config *files* are carried into the sandbox with registry URLs
rewritten through the loopback relay (credentials stay in the server). uv's configuration often rides in
**environment variables** (`UV_DEFAULT_INDEX`, `UV_PYTHON_INSTALL_MIRROR` in HKCU\Environment), which the
sandbox's env filter strips — so confined uv falls back to pypi.org (DNS fails air-gapped) or, pointed at
Nexus directly, is refused by the closed private network (WSAEACCES 10013). With a relayed index, the relay
itself is loopback and open: installs work with no manual variable.

## What Changes

- `userConfigsToCarry` (server/src/terminalSandbox.ts): when there is no `%APPDATA%\uv\uv.toml` but the
  environment sets `UV_DEFAULT_INDEX` and/or `UV_PYTHON_INSTALL_MIRROR`, the carried `uv.toml` is
  **synthesized** from them (`default-index = "…"`, `python-install-mirror = "…"`). `CarriedConfig` gains an
  optional `synthesized` text used when `from` does not exist; `carryUserConfigs` and `carriedSummary` fall
  back to it, and the copy is removed when neither file nor variables exist.
- The synthesis flows through the existing `withoutCredentials`/`throughRelay` path, so `user:pass@` URLs
  are rewritten to the relay and the credentials registered server-side — same as a carried uv.toml file.
- A real `uv.toml` file still wins over the variables. The `UV_*` variables themselves are NOT propagated
  into the confined environment (they would point at the intranet, closed by default).

## Capabilities

### Modified Capabilities
- `sandbox-runner-bash`: uv configured by environment variables gets a carried, relayed `uv.toml` in the sandbox.
