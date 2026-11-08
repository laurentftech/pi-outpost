# Design

## Context

See proposal.md for the motivation. The mechanism behind `sandbox.allowedHosts` already ignores which
runner confines the shell:

- `egressProxy.ts` is an HTTP CONNECT proxy that filters by host name. One proxy is shared per list
  (`sharedEgressProxy`), and `confinedBash.ts` starts a dedicated proxy for each command when hosts may
  be asked about.
- The refusal note, the host questions (`askHost` → grant broker) and `run_with_grant` are independent
  of the runner.

Each runner contributes only "network closed except the proxy port" and the proxy variables:

| Runner | Closing | Variables |
| --- | --- | --- |
| MXC Windows | `egress: deny` + `hostLoopback: allow` | set by MXC |
| MXC Linux | `egress: deny`, slirp4netns | rewritten by MXC |
| Seatbelt | SBPL: outbound only to `localhost:<port>` | set by `seatbeltPolicy` |

In landstrip's policy (`network`), `allowNetwork: false` denies direct TCP/UDP. `httpProxyPort` /
`socksProxyPort` permit loopback TCP to those ports and start no proxy. On Linux this is enforced by
landstrip's seccomp supervisor, which mediates `connect`. The field exists in 0.19.8 and later; this
change moves CI and the Docker image to 0.20.26, the version the user chose.

Today, `terminalPolicy` always writes `network: { allowNetwork: true }`. Its landstrip branch in
`confinedBash.ts` does not receive `networkProxy`. `config.ts` refuses the key unless the runner is MXC
or Seatbelt. `hostGrantsRefusal` admits only `mxc` and `seatbelt`.

In Docker, `/opt/landstrip/bin/landstrip` is the `landstrip.cjs` adapter. Unless the operator opts in, it
forces `allowNetwork: false` and `allowLocalBinding: false`. It does not touch the proxy ports.

## Goals / Non-Goals

**Goals:**
- Accept `sandbox.allowedHosts` with landstrip on Linux, for the agent's shell, with the guarantees
  already specified for MXC and Seatbelt.
- Admit landstrip on Linux into host questions on a CI proof, not by declaration.
- In Docker: an image that asks about every host by default, an upgrade that never opens the network,
  and a total refusal kept as a simple option.

**Non-Goals:**
- landstrip on Windows (AppContainer): MXC is the runner there, and the key stays refused.
- The terminal panel under `sandbox.allowedHosts`: unchanged, as for every runner.
- Pre-listed hosts (PyPI, npm): the empty list asks about them, and the operator lists them in
  `/data/config.json` if they want to.
- The template `deploy/docker/config.json` keeps no `allowedHosts`. The bootstrap adds it, to a fresh
  volume as to an existing one, so that a recipe built with an older `PI_OUTPOST_VERSION` still starts.
- SOCKS: the server's proxy is HTTP only; `socksProxyPort` is never written.

## Decisions

### landstrip's network section is derived from the proxy URL, as for Seatbelt

`terminalPolicy` receives `networkProxy` (the URL). It then writes
`network: { allowNetwork: false, allowLocalBinding: false, httpProxyPort: <URL port> }`. Without it, the
section stays `{ allowNetwork: true }`, unchanged. `allowLocalBinding` is written explicitly at
`false`: landstrip says it opens host-local TCP/UDP, which would reopen the loopback.

The dedicated proxy of a command has its own port, written into that command's policy alone. Isolation
between commands therefore comes from the policy itself, port by port. Under MXC on Windows it had to
be measured, because the loopback is open in full there.

*Alternative*: the landstrip API's proxy (`landstrip-api/lib/proxy.js`, used by pi-landstrip). Rejected:
it would duplicate `egressProxy.ts`, its refusals, its notes and its questions, for one runner.

### Proxy variables: one helper shared with Seatbelt

`seatbeltPolicy` sets `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and their lower-case forms to the proxy
URL. That list moves into a function used by both, so the two runners cannot drift. `NO_PROXY` is not
set: the whole loopback except the proxy is closed anyway.

### landstrip's admission is by platform, and only after the proof

`config.ts` accepts the key with landstrip only when `process.platform === "linux"`. On Windows the
message names MXC. In `hostGrantsRefusal`, landstrip is admitted only on Linux, in the same commit that
adds landstrip to the real `another session's proxy` test (`sandboxGrantsReal.test.ts`). CI's Linux job
already sets `LANDSTRIP_BIN` there. Before that commit, an unlisted host is refused at once, which is
the behaviour of an unproven runner.

### The proof runs on the version that ships

CI's Linux job and the Docker image both use landstrip 0.20.26. It creates user, PID and mount
namespaces, which Ubuntu 24.04's AppArmor refuses to an unprofiled process: the Linux job sets
`kernel.apparmor_restrict_unprivileged_userns=0`, as the `mxc-linux` job already does. It is an
AppImage, extracted since the runner has no FUSE. The real network tests run in both places:
- CI's Linux job (`confinedNetworkLandstrip.test.ts`, `sandboxGrantsReal.test.ts`);
- the Docker job (`deploy/docker/test.mjs`). It now builds the image from the branch's CLI, packed
  as the release packs it. Before, it installed the published 0.59.1, which would refuse the
  configuration this bootstrap writes.

### landstrip opens the proxy's port on every loopback address: the proxy holds `[::1]` too

Measured on 0.20.26: with `httpProxyPort: P`, a command reaches `127.0.0.1:P`, and also
`127.0.0.2:P` and `[::1]:P`. Every other port, local or remote, is refused, and so are UDP,
pathname Unix sockets and `bind`. The man page describes this ("loopback TCP to those ports"). The
user chose to mitigate it and to ask upstream for an address restriction:
- `egressProxy.ts` listens on `127.0.0.1:P` and holds `[::1]:P`, which it serves too. A port taken
  on `[::1]` is given up for another, and without IPv6 nothing can listen there. So the number
  leads only to the proxy, except on another `127.x` address. A service of the host would have to
  listen there under the same ephemeral number, which is documented in `docs/sandboxing.md`.
- An issue for landstrip asks that a proxy port be bound to an address.

*Alternative*: bind the proxy on `0.0.0.0:P` to hold the number on every IPv4 address. Rejected: it
would expose the proxy on the container's or host's network interfaces.

### Docker: by default, the user is asked; `0` is a total refusal; `1` follows the configuration

The user asked for three things: keep a total refusal, make it no longer the default, and keep the
variable simple. The obvious default for the image is the questions. Retained, with the same variable:

| `ALLOW_AGENT_NETWORK` | Adapter (ceiling) | Bootstrap | Result |
| --- | --- | --- | --- |
| unset (default) | proxy port allowed, `allowNetwork` and `allowLocalBinding` forced to `false` | adds `sandbox.allowedHosts: []` if missing | agent's shell: every unlisted host asked about; terminal: closed |
| `1` | forwards unchanged | does not touch the configuration | per the configuration (open without the key) |
| `0` | `allowNetwork`/`allowLocalBinding` `false`, `httpProxyPort`/`socksProxyPort` removed | does not touch the configuration | no network at all |

- **Why the default ceiling closes a policy without a proxy**: an existing volume, or a pi-outpost
  too old to accept the key, has no `allowedHosts`. Without this ceiling, an upgrade would turn a
  closed network into an open one. With it, removing the key under the default never opens anything:
  for that, the operator must say `1`.
- **Why the bootstrap adds the key**: so that a fresh or an existing volume gets the questions, instead
  of a closed network with no way out. It is harmless under the default, since without the key the
  ceiling closes. Under `1` the configuration is the operator's, and is not touched.
- **When the installed pi-outpost refuses the key** (`PI_OUTPOST_VERSION` older than this change):
  `pi-outpost doctor` says `"sandbox.allowedHosts" needs …`. The bootstrap then removes what it
  added, logs it, and starts with the network closed, as before. Startup never fails because of this,
  and the network never opens.
- The adapter keeps its rule: it only tightens. `0` and `1` keep a meaning close to the old one. `0` is
  closed, even more so than before. `1` means "the configuration decides", the old opt-in. Only the
  unset default changes, from closed to questions, and the release notes say so.
- `bootstrap.mjs` accepts unset, `0` and `1`, refuses anything else naming the values and the default,
  and logs the active mode.

*Alternatives considered*:
- A new variable `AGENT_NETWORK=ask|config|none`. Clearer to read, but a second name and a migration
  for those who already wrote `0`/`1`. The table above gives the same three modes.
- Leave the template alone and follow the configuration by default (open network without the key).
  Rejected: the image must ask by default, and an upgrade would have opened the network.

## Risks / Trade-offs

- [The loopback filter keys on the port, not on the address — confirmed] → See the decision above:
  the proxy holds `[::1]`, the other `127.x` addresses remain, documented, and an upstream request
  is filed. `UnderLandstripNoOtherLoopbackAddressReachesAService` checks that another port is
  refused on `127.0.0.1`, `127.0.0.2` and `[::1]`, and that the proxy's number on `[::1]` answers
  with the proxy itself.
- [Pathname Unix sockets lead to a proxy or a daemon] → `allowUnixSockets` stays empty and
  `allowAllUnixSockets` false, as today; landstrip keeps service-manager sockets denied. The test adds
  an attempt on a Unix socket listening in the temporary directory.
- [Tools that ignore `HTTPS_PROXY`, or do direct DNS/UDP] → They fail, as under Seatbelt. The note and
  `docs/sandboxing.md` say so.
- [Under the Docker default, questions require a connected browser] → Without one, a host is refused
  (no answer = refusal), which is never worse than the old closed network. `pip install` asks about
  `pypi.org` and `files.pythonhosted.org`: "for the session" covers the rest of the session, and
  `docs/docker.md` shows how to list them in `/data/config.json`.
- [The bootstrap writes into the operator's configuration] → Only the missing key, only under the
  default, in the write `bootstrap.mjs` already does (descriptor opened without following a symlink).
  The startup log says so.
- [Confinement canary] → It judges files and the environment, not the network. Nothing to change,
  checked in the tests.

## Migration Plan

1. Archive `host-questions-on-posix-runners` (complete) and `add-docker-python-deployment` (its last
   task is a post-release check), so that this change's deltas apply to main specs that contain them.
2. Server: config, policy, proxy variables, without `hostGrantsRefusal` (unlisted host refused at once).
3. Real proof in CI, then admission into `hostGrantsRefusal`.
4. Docker: adapter, default, tests, docs, release notes.

Rollback: removing the key from the configuration brings back the open network. In Docker,
`ALLOW_AGENT_NETWORK=0` brings back the total refusal.

