# Proposal: the refusal note does not claim "the Internet is open"

## Why

On a machine with no route to the Internet (air-gapped), the note that ends a failed command's output
when no host can be named says, without `sandbox.allowedHosts`:

```
[pi-outpost] the sandbox refused a network connection (WSAEACCES, 10013): it is not a network
failure, and retrying will not help. Here the Internet is open; the private network … is closed …
```

Both claims are false there. Without `sandbox.allowedHosts` the sandbox's policy leaves egress
unrestricted (`egress: { default: "allow" }`) — it does not make the Internet reachable, and on an
air-gapped machine the same WSAEACCES (10013) comes from the machine's own firewall, not from the
sandbox. The note as worded sends the agent looking for a sandbox setting that does not exist, and
tells the user the opposite of what their machine does. Measured while chasing network grants on an
air-gapped Windows 11 machine (issue thread of #572).

## What Changes

- The note's no-host branch SHALL NOT say "the Internet is open" nor "the sandbox refused a network
  connection" when no host was named. It SHALL say a connection was refused (WSAEACCES, 10013), that
  the sandbox closes only the addresses it names (the private network unless
  `sandbox.privateNetwork`, the machine's own services when `sandbox.hostLoopback` is false) — on an
  air-gapped machine the same error comes from the machine's own firewall — that the sandbox does not
  restrict outbound connections without `sandbox.allowedHosts` (whether the Internet answers is the
  machine's network, not the sandbox's), and that retrying will not help.
- The named-host branch (a host the sandbox's policy refuses) and the `allowedHosts` proxy branch are
  unchanged: there the sandbox did refuse the connection.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: requirement `ASandboxRefusalIsNamed`, the note's wording where no host can
  be named.

## Impact

`server/src/confinedBash.ts` (`socketRefusedNote`), `server/test/socketRefused.test.ts`,
`docs/sandboxing.md` (the paragraph after the named-host note), and the `sandbox-runner-bash` spec.
