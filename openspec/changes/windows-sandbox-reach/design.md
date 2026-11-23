## Measured

Windows 11 24H2 (26100.9711), mxc-sdk 1.1.0, probe `base-container` with `baseContainerSupportsEnumeratePaths: true`.

**Folders above a tool.** Root under `C:\Users\…\Temp`, a tool in `C:\zz553\nodejs\current\bin` on `PATH`:

| | before | `enumeratePaths` on `C:\zz553`, `C:\zz553\nodejs` |
| --- | --- | --- |
| `node C:\zz553\…\foo.js` | `EPERM: lstat 'C:\zz553'` | runs |
| `realpath` of the tool's folder | EPERM | OK |
| read `C:\zz553\secret.txt` | refused | refused |
| list `C:\zz553\other` | refused | **listed** — enumeration covers the subtree |
| list `C:\zz553\other`, with `C:\zz553\other` also denied by name | — | refused |

Hence the deny by name beside the way down. Enumerating a folder already readable through the drive
(`C:\Program Files`) would make its subtree list-only: such folders are never enumerated.

**The private network.** A listener on the host, and the machine on `10.0.0.0/24`:

| `network` | `10.0.0.1:80` (gateway) | `1.1.1.1:443` | host's loopback | own LAN address |
| --- | --- | --- | --- | --- |
| `egress allow`, `ingress {deny, hostLoopback allow}` (before) | 10013 | connected | connected | connected |
| same, plus `egress.allow` to 10/8, 172.16/12, 192.168/16 | 10013 | connected | connected | — |
| `egress allow`, `ingress {allow, hostLoopback allow}` | connected | connected | connected | connected |
| `egress allow`, `ingress {allow}` | connected | connected | 10013 | 10013 |
| `egress allow` | 10013 | connected | 10013 | 10013 |

The two keys are independent. What Windows counts as private is the subnets the machine is on (and
intranet ranges a policy names): `10.254.254.254`, off-subnet, is not refused even when closed. The
machine's own address counts as its loopback.

## Decisions

**Enumerate, not read.** The folders above a tool are given the least that lets a path resolve. Reading
them would open other projects' files beside the tool; enumerating with the rest denied by name shows the
names on the way down and nothing else.

**Only what is opened by path beside the root.** The search path's folders, their installations, the
shell's folder and the grants. Not the temporary directory: it sits under the profile, whose `AppData\Local`
holds hundreds of entries each to deny at every launch, and it worked before. Not git's single files.

**`privateNetwork` on by default.** The rest of the network is open by default and documented so; a
company's mirror, git server or proxy on the intranet being refused was the inconsistency #552 hit. Same
shape as `hostLoopback`: a key to close it again. What it costs is inbound connections from the private
network reaching a listener inside the container — still behind Windows' firewall. Under `allowedHosts`
the request is unchanged.

**Proxy variables without credentials.** A `user:password@` proxy is a secret: left out, named on the
startup line so the operator knows why the command cannot get out. Under `allowedHosts` none are passed —
`NO_PROXY` would route around the server's proxy.

## Not done

- A system proxy set by PAC or WinHTTP rather than variables: not read.
- `sandbox.allowedHosts` behind a company proxy: the server's proxy connects directly, with no upstream.
