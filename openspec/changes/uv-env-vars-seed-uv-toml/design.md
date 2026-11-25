# Design

## Decisions

- **Synthesize, don't propagate.** Passing `UV_DEFAULT_INDEX` through to the confined shell would point uv
  at the intranet Nexus, which the sandbox's private-network deny refuses (10013) — that is the bug. The
  carried-config mechanism exists precisely to route registries through the loopback relay, which holds the
  credentials and is reachable. So the env vars become a `uv.toml` *text*, carried like any other config.
- **Only when no file exists.** A real `%APPDATA%\uv\uv.toml` is carried as today; on the host, env vars
  override the file, but merging the two in the sandbox would need uv's precedence rules reimplemented —
  out of scope. File wins.
- **Two settings only**: `default-index` (UV_DEFAULT_INDEX) and `python-install-mirror`
  (UV_PYTHON_INSTALL_MIRROR). The latter matters air-gapped: without it, installing a managed CPython hits
  github.com. `UV_SYSTEM_CERTS` is unnecessary once the relay speaks plain HTTP on loopback.
- **Removal follows the source**: when the variables disappear and no file exists, `carryUserConfigs`
  removes the marked copy, as it does for a removed file.
- The synthesized URLs carry `user:pass@`, so `throughRelay`'s generic URL rewrite (which already names uv's
  indexes) sends them through the relay and `withoutCredentials` reports them left out — the existing
  relay path needs no change.

## Files

- `server/src/terminalSandbox.ts` — `CarriedConfig.synthesized`, the uv.toml synthesis in
  `userConfigsToCarry`, the `?? config.synthesized` fallbacks in `carryUserConfigs` and `carriedSummary`.
- `server/test/userConfigs.test.ts` — the scenario's test.
- `docs/sandboxing.md` — the carried-config table's uv row.

## Out of scope (noted in #570)

- `Set-Location` into a read-only granted folder is refused while `Get-ChildItem` on it works — that is the
  documented tier-1 behaviour (a read-only folder cannot be a working directory), not a grant bug.
- uv's cross-drive hardlink warning (cache on C:, project on L:) is cosmetic; `UV_LINK_MODE=copy` would
  silence it at the cost of slower installs for everyone — left alone.
- The private-network default and the "Here the Internet is open" diagnostic wording on air-gapped hosts —
  a separate question from uv.
