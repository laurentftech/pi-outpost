# A confined shell reaches only the hosts the deployment names

## Why

Under MXC the agent's shell cannot read beside its root, hold a key, or touch the user's desktop —
but its network is open. A command can still send whatever it reads in the root anywhere: the
sandbox stops a leak at the disk, not at the wire. Today only a permission extension asking before
`curl` or `git push` stands there, and it reads command text, which a wrapper or a program the
agent builds walks past (gotgenes/pi-packages#926).

MXC's process container can close the network and leave one way out: a proxy the server runs.
Measured on Windows 11 with MXC 1.0.1 (`wxc-exec.exe` driven with pi-outpost's own
`mxcTerminalConfig`, network fields changed; probe in the investigation notes below):

| Request | DNS | Direct TCP | Through the proxy |
|---|---|---|---|
| `egress.default: "allow"` (today) | resolves | — | — |
| `egress.default: "deny"` | refused | refused (access denied) | — |
| `deny` + `runtimeConfig.networkProxy` + `ingress: { default: "allow", hostLoopback: "allow" }` | resolves | refused, `curl --noproxy` too | allowed hosts answer (`curl` 200 from registry.npmjs.org, `git ls-remote https://github.com/…` works); others refused by the proxy (403) |

With the proxy, MXC itself sets `HTTPS_PROXY` and `HTTP_PROXY` in the command's environment; curl
and git follow them. Another service listening on the host's loopback stayed unreachable — only the
proxy was. MXC refuses `networkProxy` without `ingress.default: "allow"`, and without
`hostLoopback: "allow"` unless `processContainer.network.allowedProxyPeer` is set (that variant did
not reach the proxy in the probe; not pursued). Windows PowerShell 5.1's `Invoke-WebRequest` ignores
`HTTPS_PROXY`: without `-Proxy` it goes direct and is refused — closed, not open.

## What Changes

- A new `sandbox.allowedHosts`: a list of host names (`registry.npmjs.org`) or suffixes
  (`*.githubusercontent.com`). When set, every command of the agent's shell confined by MXC's
  process container runs with outbound traffic denied and the server's proxy as its only way out.
- The server runs that proxy on its loopback: `CONNECT` to an allowed host on port 443 is relayed,
  anything else is answered `403` with a body naming the host and `sandbox.allowedHosts`, so the
  model can say why and ask the user rather than retry blindly. Each refusal is logged.
- A confined PowerShell script also gets `Invoke-WebRequest` and `Invoke-RestMethod` pointed at the
  proxy (`$PSDefaultParameterValues`), beside the other defaults its prelude sets.
- `sandbox.allowedHosts` without MXC as `bashRunner`, or with `bashImage` (WSLC), is refused at load
  with the reason: no other backend enforces it here.
- Without `sandbox.allowedHosts`, nothing changes: the network stays as open as it is today.

## Out of scope

- The terminal panel: it is the user's own shell, and keeps the network.
- WSLC: its proxy must be routable from the container, and its network is fixed at provision;
  a later change.
- Linux (landstrip) and per-command approval: pi-permission-system keeps that role.

## Impact

`server/src/config.ts` (new key, validation), `server/src/terminalSandbox.ts` (`mxcTerminalConfig`
network and `runtimeConfig`), `server/src/confinedBash.ts` (PowerShell prelude), a new proxy module
started with the server, `docs/sandboxing.md`, README configuration table. A deployment that sets the
key trades `npm install`, `git fetch` and the like against any host it did not name; the refusal says
which one to add.

## Investigation notes

Probe: the confined `powershell` request built by `mxcTerminalConfig` for a temporary root, with
`network` and `runtimeConfig` replaced per row, run by `wxc-exec.exe`; a Node `CONNECT` proxy on
`127.0.0.1` allowing `registry.npmjs.org` and `github.com` and recording every request; a second
local HTTP service to check loopback reach. MXC also requires `LOCALAPPDATA` in the given
environment (pi-outpost's minimal environment already carries what the real suites need).
