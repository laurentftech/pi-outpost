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

## Measured on Windows 11 (task 1.1, 1.2)

Probe: `scripts/probes/mxc-capture-denials.mjs`, `wxc-exec.exe` 1.1.0 (x64), request `1.0.0`, `processContainer.captureDenials: { mode: "block" }`. Layout: `app\` readable, `app\out\` writable, `other\` in `deniedPaths`; `cmd.exe` reads `app\readme.txt`, reads `other\secret.txt`, writes `other\w.txt`, writes `app\out\a.txt`.

- **Enforcement kept**: both accesses to `other\` refused ("Accès refusé"), `other\w.txt` absent, `app\out\a.txt` written. Same as without capture.
- **The announcement** is the last stderr line, as documented: `{"type":"captureDenials","outputPath":…,"exitCode","totalDenials","deniedResourcesTruncated"}`. It is mixed into the command's own stderr, so it must be stripped from what the agent sees.
- **Where**: by default `%TEMP%\mxc_denials_<pid>_<hash>.json` — outside the sandbox's writable zone, left behind (the caller deletes it). With `outputPath: X.json`, MXC writes `X.<pid>_<hash>.json`, **not** `X.json`: only the announced path is reliable.
- **Shape**: as documented, plus a `filetime` per entry. Values seen: `resourceType` `file`, `other` (a registry key), `ui` (`Handles`); `accessType` `read`, `write`, `execute`, `unknown`. Paths of directories end with `\`.
- **What it does NOT contain — the finding that matters**: neither refusal under `other\` (an explicit `deniedPaths` entry) appears. The 12 entries were noise: the ancestors of the root (`C:\`, `C:\Users\`, … each `read`), `app\` itself (`execute`, `write`), conhost's registry key and language MUI, a UI `Handles`. So MXC's report records what the *default* deny refused, not what an *explicit* deny refused — and pi-outpost denies every sibling of the path to the root explicitly (`siblingsToDeny`, needed for Git, microsoft/mxc#1464). A file beside the root is therefore never reported, which is exactly `ARefusedFileIsRecordedAgainstItsDirectory`.
- **Cost** (task 1.2): ~110–180 ms per command without capture (first run 1.26 s, cold), ~1.47 s with capture on every run: **about +1.3 s per command**, the ETW session. Always on is too heavy for an agent's shell.
- **Needs**: nothing beyond native PSEC: it ran from a non-elevated shell (checked), with no extra install or setup.

Consequences for design.md and the spec (task 1.3, not done): the Windows source cannot, as pi-outpost configures MXC, report the refusal the change is built around; the noise needs a filter (ancestors of the root, the root's own `execute`/`write`, non-`file` kinds); and recording cannot be always on at +1.3 s. Options to decide with the maintainer: (a) Windows reports nothing for files, like Linux, and only hosts are recorded there; (b) capture on demand — rerun a failed command once with capture and with the siblings moved from `deniedPaths` to the default deny where Git allows it; (c) ask upstream whether explicit denies can be reported.

**Rerun with `other\` left to the default deny** (`MXC_DEFAULT_DENY=1`, not in `deniedPaths`): still enforced (`other\w.txt` absent), and the report now holds `file read …\other\` and `file write …\other\w.txt`, beside the same noise. So the report records default-deny refusals only: an explicit `deniedPaths` entry is silent. The read of `other\secret.txt` shows as a read of its directory, which is what a rule names anyway.

**Caveat on that rerun**: the probe's policy had no readable drive. pi-outpost's has `C:\` in `readonlyPaths`, with the siblings refused by name. Dropping the siblings alone would make them *readable*, so a diagnostic rerun drops the drive too (design.md, "On Windows, refusals are reported on demand").

## Measured on macOS (task 2.3)

Probe: `scripts/probes/mxc-capture-denials-mac.mjs`, an Apple M1 on macOS 27.2.1, Node.js 24.22, `@microsoft/mxc-sdk` 1.1.0. The request is the development contract `1.1.0-alpha` with `seatbelt.captureDenials: { mode: "block" }`, sent through `@microsoft/mxc-sdk/v1/dev`'s `spawnJson(json, { experimental: true })`. Layout: `app/` readable, `app/out/` writable, `other/` left to the default deny, `named/` in `deniedPaths`; network egress denied. `/bin/sh` reads and writes in each, lists `~/Documents`, asks for a host with `curl`, and reads the pasteboard.

- **Enforcement kept**: every access outside the policy is refused ("Operation not permitted"), nothing is written under `other/` or `named/`, `app/out/a.txt` is written. Output and exit code are the same as without capture.
- **The announcement is structured, not on stderr**: `outputMetadata.captureDenials` holds `{ type, outputPath, exitCode, totalDenials, deniedResourcesTruncated }` (and `etlPath` with `retainEtl`). The command's stderr carries nothing of MXC's, so nothing has to be stripped.
- **Where**: by default `$TMPDIR/mxc_denials_<pid>_<hash>.json` of the *server's* temporary directory, with a `…verbose.json` beside it (`signatures`, `summary`, `version`). Both are left behind: the caller deletes two files. With `outputPath: X.json`, MXC writes `X.<pid>_<hash>.json` and `X.<pid>_<hash>.verbose.json`, as on Windows: only the announced path is reliable. `retainEtl` adds `X.<pid>_<hash>.seatbelt.log`, the raw `log stream` lines.
- **Shape**: `{ denials: [{ resource, resourceType, accessType, pid, filetime }], summary: { exitCode, totalDenials, deniedResourcesTruncated } }` — the list is `denials`, not Windows' `deniedResources`. A file refusal's `resource` is the **file's own full path**, resolved (`/private/var/folders/…`), with `accessType` `read` or `write`.
- **What it contains — unlike Windows**: both the default deny's refusals (`other/secret.txt` read, `other/w.txt` write, `~/Documents` read) **and** the ones named in `deniedPaths` (`named/secret.txt` read, `named/w.txt` write). An explicit deny is reported. Three runs gave the same 13 entries.
- **Noise**: none of it is a `file`. Under a policy shaped as `mxcMacConfig`'s, `ls`, `git init && git status`, `node -e`, `curl https://…` and `true` each succeeded and reported 2 to 6 entries, all `resourceType` `other`: `ipc-posix-shm-read-data:apple.shm.notification_center`, `mach-lookup:com.apple.system.opendirectoryd.libinfo`, and for some `system-info:vfs.disk-space`, `mach-lookup:com.apple.logd`, `…diagnosticd`, `…SystemConfiguration.configd`. With egress denied, a refused host shows as `network unknown network-outbound:/private/var/run/mDNSResponder` (the resolver's socket, not the host: the proxy remains the source for hosts), and the pasteboard as `ui unknown mach-lookup:com.apple.pasteboard.1`. Keeping `resourceType === "file"` drops all of it; no ancestors of the root, no entry for the root itself.
- **Cost**: 121–130 ms per command without capture; 171–184 ms with it once warm (**about +50 ms**), 495 ms on the first run. Against Windows' +1.3 s.
- **Needs**: nothing. It ran over SSH, not elevated, with no permission asked for reading the unified log.
- **Contract**: only `1.1.0-alpha` carries `seatbelt.captureDenials`, and only with `experimental: true`. The stable `v1` `spawn` that `sdkRequest` targets does not.

Consequences: macOS can report file refusals **as they happen**, like landstrip — the explicit denies are in the report, so no narrower rerun is needed, and the cost fits every command. What it asks in exchange is every macOS command through MXC running on the development contract. The alternative is Windows' way: `diagnose`, on demand, the alpha contract used for that rerun only. Decided: as they happen (`design.md`).

## Found on the way (macOS and Linux, PR #504's first CI run)

- **The terminal exited at once on Linux and macOS** (`^D`, exit 1): the SDK's `wait()` ends an input nobody has taken yet (`container-process.js`: "Untaken stdin is closed"), and `mxcPty` called `wait()` before reading `input`. Taking `input` first fixes both platforms; `mxcSdk.test.ts` pins it with a fake that has the SDK's rule.
- **Linux, the server's environment was readable from the sandbox.** Reproduced in Docker (`scripts/mxc-linux/test.sh`: 29 of 30, `key-visible=1`). The SDK has no option for the environment `bwrap` itself starts with, so Linux runs `lxc-exec` again, started with the command's environment: 30 of 30, `key-visible=0`.
