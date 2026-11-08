<!-- Draft, not posted yet: for https://github.com/landstrip/landstrip/issues once the maintainer of pi-outpost has read it. -->
# Linux: let a proxy port be bound to one loopback address

landstrip 0.20.26 (linux-x64, `landlock+seccomp`, `networkMediation: true`), Ubuntu 24.04 on WSL2,
kernel 6.18. With the network closed but for a proxy port, a command reaches that port on **every**
loopback address, not only the one the proxy listens on:

```json
{ "filesystem": { "denyRead": ["/"], "allowRead": ["/usr", "/etc", "/lib", "/lib64", "/bin", "/sbin", "<dir>"], "allowWrite": ["<dir>", "/dev/null"] },
  "network": { "allowNetwork": false, "allowLocalBinding": false, "httpProxyPort": 47001 } }
```

Services of the host, outside the sandbox, listening on `127.0.0.1:47001`, `127.0.0.1:47002`,
`127.0.0.2:47001` and `[::1]:47001`, plus a pathname Unix socket. From
`landstrip run -p policy.json -- python3 probe.py`:

| Connect from inside | Result |
|---|---|
| `127.0.0.1:47001` (the proxy port) | reached |
| `127.0.0.1:47002` | `EACCES`, `NETWORK_DENIED` (seccomp) |
| `127.0.0.2:47001` | **reached** |
| `[::1]:47001` | **reached** |
| `1.1.1.1:443`, UDP to `1.1.1.1:53`, the Unix socket, `bind` | refused |

This matches the man page ("Linux/macOS proxy ports permit loopback TCP to those ports"), so it is
not a bug report. It does mean that a host service listening on another loopback address under
the proxy's port number can be reached from inside the sandbox. A proxy usually takes an
ephemeral port: the kernel guarantees that number free on the address the proxy binds, not on
`[::1]` or the rest of `127.0.0.0/8`.

pi-outpost uses `httpProxyPort` for its egress proxy (`sandbox.allowedHosts`). As a mitigation it
now also holds the same port on `[::1]`. It cannot hold the number on every `127.x` address without
binding `0.0.0.0`, which would expose the proxy beyond the loopback.

**Request.** An optional address for the proxy ports, for example
`"httpProxyAddress": "127.0.0.1"` (or `httpProxyPort` accepting `"127.0.0.1:47001"`), so that the
seccomp check matches the destination address as well as the port. Without the field, the current
behaviour is kept.

Reproduction script: `landstrip-proxy-port-address.sh` (beside this file), attached; it starts the listeners, writes the policy above and
runs the probe.
