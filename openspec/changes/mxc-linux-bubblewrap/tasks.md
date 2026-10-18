## Tasks

- [x] Feasibility under Docker with MXC 1.0.1's `lxc-exec` (proposal, Measured).
- [ ] Measure an interactive terminal (pty) through `lxc-exec`; settle whether the terminal takes MXC on Linux, and update the spec if not.
- [ ] `"mxc"` and `lxc-exec` paths on Linux: executor resolution, `runnerKind`, configuration.
- [ ] The Linux self-check: one confined `/bin/true` with the configuration's network shape; MXC's reason on refusal.
- [ ] The Bubblewrap request: filesystem, environment, network (open, or `sandbox.allowedHosts` with `ingress: deny` and the proxy).
- [ ] The terminal under MXC on Linux, or its refusal with the reason.
- [ ] Unit tests; real-executor tests in a Docker container with the documented flags (an image and a script to run them); running-app check with the agent in that container.
- [ ] `docs/sandboxing.md` (option, Docker flags and packages, trade-off), README rows; scenario coverage matrix; strict OpenSpec validation.
