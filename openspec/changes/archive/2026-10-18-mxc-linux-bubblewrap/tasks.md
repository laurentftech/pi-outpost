## Tasks

- [x] Feasibility under Docker with MXC 1.0.1's `lxc-exec` (proposal, Measured).
- [x] Measure an interactive terminal (pty) through `lxc-exec`; settle whether the terminal takes MXC on Linux, and update the spec if not. (Works: size, resize, Ctrl-C — the terminal takes MXC; spec unchanged.)
- [x] `"mxc"` and `lxc-exec` paths on Linux: executor resolution, `runnerKind`, configuration.
- [x] The Linux self-check: one confined `/bin/true` with the configuration's network shape; MXC's reason on refusal.
- [x] The Bubblewrap request: filesystem, environment, network (open, or `sandbox.allowedHosts` with `ingress: deny` and the proxy).
- [x] The terminal under MXC on Linux, or its refusal with the reason.
- [x] Unit tests; real-executor tests in a Docker container with the documented flags (an image and a script to run them); running-app check with the agent in that container. (Run on macOS/OrbStack: the documented flags gained `systempaths=unconfined` and `--init`, the image `iproute2`; `getCwd` steps past MXC's `sh -c` wrappers.)
- [x] `docs/sandboxing.md` (option, Docker flags and packages, trade-off), README rows; scenario coverage matrix; strict OpenSpec validation.
