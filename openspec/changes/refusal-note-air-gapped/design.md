# Design: the refusal note does not claim "the Internet is open"

## Where the note comes from

`socketRefusedNote(network, refused?)` in `server/src/confinedBash.ts`, printed at the end of a failed
command's output under MXC on Windows (`diagnosable`, not a diagnosis, and either the output matched
the refused-connection signal or `refusedHost` named a host the policy refuses).

Two shapes:

- `refused` set — a host was named and judged by the sandbox's own policy (`refusedHost`): private
  network while `sandbox.privateNetwork` is not true, or the machine itself while
  `sandbox.hostLoopback` is false. There the sandbox did refuse that address; the note is accurate
  and stays.
- `refused` unset — only the output's error text matched (WSAEACCES and its localised wordings,
  `reportsSocketRefused`). Without `sandbox.allowedHosts` the policy is `egress: { default: "allow" }`
  with ingress closed for the private network and, unless `hostLoopback` says otherwise, the loopback
  open — so a refusal MXC caused can only be one of those address classes, but the same WSAEACCES is
  also what the machine's own firewall returns on an air-gapped machine for anything outside. The
  note cannot tell the two apart, so it must not claim either "the sandbox refused" or "the Internet
  is open".

## The new wording (no host named, no proxy)

```
[pi-outpost] a network connection was refused (WSAEACCES, 10013): the sandbox closes only the
addresses named below — on an air-gapped machine the same error comes from the machine's own
firewall — and retrying will not help. Here the sandbox does not restrict outbound connections (no
sandbox.allowedHosts), so whether the Internet answers at all is this machine's network, not the
sandbox's; the private network (the intranet: a company's mirror, git server or proxy) is closed
unless the user sets sandbox.privateNetwork to true; this machine's own services too. Only the user
can open it: if the task needs it, tell them which host it was.
```

The proxy branch (`sandbox.allowedHosts`) keeps "the sandbox refused a network connection (a direct
one: no route but the proxy)": there egress is denied, so the sandbox did refuse the direct
connection.

## Why not detect the air gap

Asking the host whether the Internet answers before the note would add a network probe to every
failed command and still could not attribute a single WSAEACCES to MXC or to the firewall. The
wording fix attributes nothing and states the policy, which is all the sandbox knows.
