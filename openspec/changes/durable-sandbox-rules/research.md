# Research: MXC learning mode and durable rules

Starting point for this change: what MXC 1.1.0's learning mode provides, what pi-outpost has today, a sketch, and what is still unverified. Written after the bump to `@microsoft/mxc-sdk` 1.1.0 (#500).

## What MXC's learning mode provides

After a confined command, MXC can write a JSON report of the accesses the sandbox blocked, de-duplicated per `(resource, accessType)`:

```json
{ "denials": [ { "resource": "C:\\Users\\test\\secret.txt", "resourceType": "file", "accessType": "read", "pid": 1234 } ],
  "summary": { "exitCode": 0, "totalDenials": 1, "deniedResourcesTruncated": false } }
```

- `resourceType`: `file`, `network`, `ui`, `capability`, `other`; `accessType`: `read`, `write`, `execute`, `unknown`.
- Two modes: `block` (enforcement unchanged, denials recorded) and `allow` (accesses the policy would block by default go through and are recorded; explicit denies still apply).
- The report's path is announced on stderr as one JSON line (`{"type":"captureDenials","outputPath":…}`).

| Platform | Available | Request contract needed |
|---|---|---|
| Windows, ProcessContainer | yes (`processContainer.captureDenials`) | `1.0.0` — the one pi-outpost already sends |
| macOS, Seatbelt through `mxc-exec-mac` | yes, new in 1.1.0 (`seatbelt.captureDenials`) | `1.1.0-alpha`, a development contract |
| Linux, Bubblewrap | no | — |
| landstrip | already reports each refusal as a JSON line on stderr (`landstripNote` in `server/src/confinedBash.ts`) | — |

Sources: [learning-mode.md](https://github.com/microsoft/mxc/blob/v1.1.0/docs/learning-mode.md), [Seatbelt learning mode](https://github.com/microsoft/mxc/blob/v1.1.0/docs/backends/seatbelt/seatbelt-backend.md#learning-mode-capturedenials), and the SDK's generated wire types (`dist/generated/v1_0_0`, `v1_1_0_alpha`).

**Not verified by running anything**: this is from the documentation and the types. No Apple silicon Mac or Windows 11 machine was at hand.

## What pi-outpost has today

- `sandbox.allowedHosts`: a fixed list of hosts always allowed; a connection to any other host asks the user on the spot (`sandbox-approved-grants`).
- `run_with_grant`: the agent asks for directories beyond the sandbox; the user approves for this command or for the session. Nothing lasts beyond the session, and there is no "never".
- Under MXC the agent sees only the program's own error ("Operation not permitted") and has to guess which path to ask for. The code says so: "MXC reports nothing of the kind: the program's own error is all there is."

## First use, smaller than rules: tell the agent what was refused

With the report, pi-outpost can end a command's output with "the sandbox refused reading `<path>`", as it already does for landstrip. The agent then asks `run_with_grant` for exactly that. Worth doing first: it is the recording half of the rules below.

## Sketch for durable rules

1. **Record.** Every refusal — MXC's report, landstrip's lines, the egress proxy's refused hosts — goes to a per-project log: resource, access, the command that hit it.
2. **Decide.** The interface lists them; for each, the user picks *always allow*, *always refuse* or *ask*.
3. **Apply.** When a command starts, *always allow* entries are added to its policy, *always refuse* entries answer without asking, anything else asks as today.

## Constraints

- Rules are about **resources** (a directory for reading or writing, a host), not commands. "Always allow `npm install`" is another mechanism, and a more fragile one.
- **Linux under MXC has no report**: it would have the network rules (through the proxy) and the agent's explicit requests only.
- **Only the user creates a rule**, never the agent; the targets that can never be granted today (the agent directory, broad or local targets — `SomeTargetsCanNeverBeGranted`) stay ungrantable.
- **Stay in `block` mode.** `allow` lifts the confinement while recording, which is wrong with an agent at the keyboard.
- macOS needs the `1.1.0-alpha` contract, which upstream marks as development: it can change.

## Open questions, to settle in an OpenSpec change before any code

- Rules per project, or global to the server?
- Stored in the configuration file, or in a separate file the interface writes?
- How a rule is shown and revoked; what an *always refuse* says to the agent.
- Whether a recorded denial of a never-grantable target is listed at all.

## To verify on Windows 11 (next step)

- `processContainer.captureDenials` with a `1.0.0` request through `wxc-exec.exe` 1.1.0: the report's real shape, its cost per command, and whether it needs anything beyond native PSEC.
- That 1.1.0 confines as 1.0.1 did (ProcessContainer and WSLC): no CI job has MXC on Windows.
- What MXC does when the Required diagnostic events cannot be sent (air-gapped machine): a delay, a logged error, or nothing.
- WSLC with WSL 3.0.5+, and whether its built-in filtering proxy lets `sandbox.allowedHosts` work with `sandbox.bashImage`, refused today.

Related: #500 (the bump to 1.1.0), #501 (seccomp profile for MXC under Docker).
