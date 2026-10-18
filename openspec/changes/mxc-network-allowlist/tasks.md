## Tasks

- [x] Feasibility probe under MXC 1.0.1: egress deny, local proxy as the only way out, loopback reach (proposal, table).
- [x] `sandbox.allowedHosts` in the configuration, with its load-time refusals; README table.
- [x] The proxy: `CONNECT` relay for listed hosts, `403` naming the host and the key otherwise, refusals logged; started with the server when the key is set.
- [x] `mxcTerminalConfig` for the agent's shell: `egress.default: "deny"`, `ingress: { default: "allow", hostLoopback: "allow" }`, `runtimeConfig.networkProxy`.
- [x] PowerShell prelude: `Invoke-WebRequest` and `Invoke-RestMethod` default to the proxy.
- [x] Unit tests (request, configuration, proxy); real-executor tests for every scenario where `MXC_EXEC` is set; running-app check with the agent.
- [x] `docs/sandboxing.md`; scenario coverage matrix; strict OpenSpec validation.
