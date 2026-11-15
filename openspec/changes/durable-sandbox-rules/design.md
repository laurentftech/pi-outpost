# Design

## Context

Three sources already know what a confined command was refused, each in its own shape:

| Source | What it knows | When |
|---|---|---|
| MXC on Windows (`processContainer.captureDenials`, contract `1.0.0`) | what its **default** deny refused: files, registry, UI; never a path named in `deniedPaths` | a JSON report after a diagnostic rerun the agent asks for |
| MXC on macOS (`seatbelt.captureDenials`, contract `1.1.0-alpha`) | files refused by default **and** by name, each by its own path; Mach services, shared memory, the resolver's socket (not hosts) | a JSON report after every command, about 50 ms |
| landstrip | one JSON line per refusal | on stderr, as it happens |
| the egress proxy | hosts it refused | as it happens |
| MXC on Linux (Bubblewrap) | nothing for files | — |

Grants today (`sandbox-approved-grants`): a host question when a command connects to an unlisted host, a directory request by the agent's tool, each for one command or one session, and a list of targets nobody can grant.

## Decisions

### One record, whatever the source

Each source is translated to the same record — kind (`directory` or `host`), target, access (`read` or `write` for a directory), the command — and anything a rule could not express (a Mach service, a Windows capability, a UI access) is recorded as informational only: shown, never offered as a rule. A file refusal is recorded against its directory, since that is what a grant and a rule widen.

### Rules are about resources, not commands

A rule names a directory with an access, or a host pattern as `sandbox.allowedHosts` writes them. It applies to every command of the project's confined shell. "Always allow this command" is not offered: a command line is trivially varied, and what confinement protects is the resource.

### Per project, held by the server, outside every sandbox

Rules are kept per project root in the server's own state directory, beside its other per-project state, never in the project tree and never in the configuration file: the first would let a confined command rewrite its own rules, the second belongs to the operator. The server's state directory is the agent directory, where the sessions of each project already are: the store is `<agentDir>/pi-outpost/sandbox-rules/<hash of the root>.json`. Under it, the store is already what can never be granted (`sandboxGrants.ts` refuses a grant within the agent directory) and never readable (every runner's policy denies the agent directory by name): no new target to keep in step. The file holds the rules and the last 200 recorded refusals; it names its root, and a file for another root is refused. *To confirm with the maintainer: per project rather than server-wide.*

### Order of consultation

For a host or a directory request: the never-grantable list first, then an always-refuse rule, then an always-allow rule, then a session grant, then the question. An always-allow directory rule is applied when a command starts, without the agent asking; an always-allow host rule answers the proxy's question.

### `sandbox.grants: "never"` switches rules off

Where the operator forbids grants, no rule is created and none is applied: a rule is a grant that lasts.

### On Windows, refusals are reported on demand, by a narrower rerun

Measured on Windows 11 with `wxc-exec.exe` 1.1.0 (`research.md`, "Measured on Windows 11"):

- the report lists only what MXC's default deny refused. A path named in `deniedPaths` is refused silently, and pi-outpost names every directory beside the path to the root there, because the drive is readable for Git (microsoft/mxc#1464). As configured, a file beside the root is never reported;
- capture costs about 1.3 s per command (an ETW session), against 0.1–0.2 s without;
- the report lands in `%TEMP%\mxc_denials_<pid>_<hash>.json`. A requested `outputPath` gets the same suffix, so only the path announced on the last stderr line is read. pi-outpost strips that line from the output and deletes the file;
- the report holds noise beside the refusal: the root's ancestors (`read`), the root itself (`execute`, `write`), conhost's registry key and language file, and UI `Handles`.

So a confined command on Windows runs **without** capture. When it fails, its output ends with a note saying this runner reports nothing on its own and naming the tool's `diagnose` option. The agent decides whether the command can safely run a second time. A command that installs, commits, appends or posts has effects that would repeat, so the call is the agent's, never automatic: a non-zero exit is no sign of a refusal (a failing test is one too). No offer follows a failure the proxy already explained by a refused host: a diagnosis runs without network, and the note before it says not to retry.

The filter cannot know every shell's own refusals (Windows PowerShell reads the default profile's `AppData` as it starts). So the first diagnosis also runs an empty command under the same policy, and what that is refused is left out of every report for the life of the server's toolset.

With `diagnose`, the command runs again with capture in `block` mode and under a policy **strictly narrower** than the original:

- the drive root is removed from `readonlyPaths`, and the siblings from `deniedPaths`, so that what was refused by name is now refused by default, and reported. Removing the siblings without the drive would make them readable, so both go. The agent directory and the configuration file stay in `deniedPaths`: either can sit inside the root, where only its name keeps it unreadable;
- network egress is denied and no proxy is given;
- no grant or always-allow rule is added.

The report is asked for in a directory of the server's own, created for the rerun and given to no sandbox, and read from there: the announcement on stderr is the command's stderr too, and a command could print one naming any file for the server to read and delete. The rerun's own output is discarded. Only its report is kept, filtered of the noise above and of everything that is not a `file` refusal, then recorded and turned into the note. Under this policy Git can fail earlier than it did (mxc#1464), so for a git command the rerun can name the drive's ancestors rather than the real refusal. Those are filtered, and the note then says nothing was found, rather than naming the wrong directory.

### On macOS, refusals are reported as they happen

Measured on an Apple M1 with `@microsoft/mxc-sdk` 1.1.0 (`research.md`, "Measured on macOS"): Seatbelt's report holds what the default deny refused and what `deniedPaths` names, each file by its own resolved path; it costs about 50 ms a command, against Windows' 1.3 s; it needs no permission; and nothing in it that is refused every command is a `file`. None of Windows' reasons for a rerun holds, so every command of the agent's shell under MXC on macOS asks for the report, and its output ends with the same note as under landstrip. Decided with the maintainer.

- **The request is the command's own on the development contract** (`mxcMacCaptureRequest`): `version` becomes `1.1.0-alpha` and `seatbelt.captureDenials: { mode: "block", outputPath }` is added; nothing else changes. It is sent as written through `@microsoft/mxc-sdk/v1/dev`'s `spawnJson` with `experimental: true` — the stable `v1` API does not carry the field.
- **The report** is asked for in a directory of the server's own, made for the command and given to no sandbox. MXC writes `report.<pid>_<hash>.json` and a `.verbose.json` beside it; only the file the SDK's result names, inside that directory, is read, and the directory is removed.
- **Kept**: entries whose `resourceType` is `file`, with `read`, `execute` (a read) or `write`. A file is recorded against its directory; a directory refused a listing is itself (the server looks). Hosts stay the proxy's: Seatbelt names the resolver's socket, not the host.
- **If the SDK no longer takes the document** — the contract is upstream's to change — nothing was started: the command runs on the stable contract, confined the same, and that shell stops asking. It then reports nothing of files.
- **The terminal is not concerned**: refusals are recorded for the agent's shell alone.

### A diagnosis reads MXC's report from the SDK's result

Through the SDK, the report's location comes back as structured metadata (`outputMetadata.captureDenials`), never through the command's stderr, which a command writes to as well. The report is still asked for in the server's private directory, and only a file inside it is read and then deleted.

### MXC runs through its SDK, but on Linux

Decided with the maintainer, after the diagnosis: two ways to run MXC — the SDK for a diagnosis, the executor for everything else and for the standalone executable — are two to keep in step. MXC's guidance names the SDK, and the executors "for testing or when the SDK cannot be embedded". So the agent's shell (`spawn`), the confinement canary, the runner's self-check (`probe`) and the terminal on macOS (`spawnWithPty`) go through `@microsoft/mxc-sdk/v1` in process, on Windows (ProcessContainer, WSLC) and macOS (Seatbelt).

**Linux keeps MXC's executor, measured.** In process, MXC's native library forks `bwrap` from the server's own process, which hands it the server's whole environment, keys included. `bwrap` is the first process of the command's namespace: the command sees it, and reads those keys from `/proc/<pid>/environ` (PR #504's first CI run, `confinedBashMxcLinux.test.ts`, `key-visible=1`; reproduced in Docker). `--clearenv` empties the command's environment, not `bwrap`'s own, and the SDK 1.1.0 has no option for the environment `bwrap` starts with. So on Linux the agent's shell, the terminal (under node-pty), the self-check and the canary start `lxc-exec` with the command's minimal environment, as before this change: `bwrap` inherits that, and holds nothing to read. The SDK is not loaded there. Weighed and left: a helper process with a scrubbed environment around the SDK (a second process model to keep for one platform), and waiting for an option upstream (asked: an environment for the sandbox's launcher, microsoft/mxc#1783). Decided with the maintainer.

**One exception, measured: the confined terminal on Windows keeps MXC's executor.** The SDK 1.1.0 has no in-process pseudo-terminal for ProcessContainer: its `spawnWithPty` starts `wxc-exec.exe` under node-pty with the whole request base64-encoded on the command line (`--config-base64`). A terminal's request denies every folder beside the path to the root by name, and measured 145 KB of JSON (2,122 denied folders in a temporary directory), 193 KB in base64: far past Windows' 32,767 characters, and the launch fails (error 206). pi-outpost therefore starts that same executor itself, with the policy as a file, as before. The standalone executable keeps `wxc-exec.exe` beside it for this. To raise upstream: a file or stdin for the PTY's request, or an in-process PTY. Decided with the maintainer.

- **The standalone executable can carry it** (measured on Windows 11, `scripts/probes/mxc-sdk-sea`): one bundle, `koffi` aliased to a module that loads it from beside the executable, `MXC_FFI_DIR` set to the executable's directory, and beside it `node_modules/koffi`, `node_modules/@koromix/koffi-<platform>-<arch>` (koffi 3 keeps its native module there) and `mxc_ffi` — about 3 MB. A confined `run` with a capture worked from inside the SEA. `build-exe` places these where it placed `wxc-exec.exe`.
- **Node.js 24.21 or 26.8** is the SDK's floor for native stdio on Windows (`spawn`, `spawnWithPty`): pi-outpost's `engines` become `^24.21.0 || >=26.8.0`, and CI follows. `run` alone works below it, but cannot be ended when a turn is aborted, so it is not kept as a fallback.
- **`"mxc"`** names MXC: in process, or through `lxc-exec` on Linux. A path to one of its executors, which a configuration written before may hold, is read as `"mxc"`, and the startup line says so: nothing is refused that worked.
- **The SDK starts `whoami /user`** found on the server's `PATH`. Under Git Bash's `PATH` it finds coreutils' and prints an error; harmless to the result. To raise upstream.

### Recording never loosens

MXC's capture is asked for in `block` mode only. Its `allow` mode lets through what the policy refuses in order to record it, which with an agent at the keyboard is the sandbox switched off. The diagnostic rerun's policy is built from the command's own by removals only, never by additions.

## Risks / Trade-offs

- The macOS report needs a contract upstream calls development, and every command of the agent's shell there now runs on it: it can change. A document the SDK refuses falls back to the stable contract for that command and the rest of the shell's life, which then reports nothing of files; a change of the report's shape yields no refusal rather than a wrong one.
- The Windows report costs about 1.3 s per command, so it is never on by default. A diagnostic rerun costs that plus the command's own time, once, and only when the agent asks.
- A diagnostic rerun replays the command's effects inside the writable root. The agent is told so in the option's description. A command that should not run twice is better diagnosed by reading its error.
- The rerun's narrower policy can make a command fail differently, with Git the first case. The note then reports nothing rather than a guess.
- An always-allow rule is a standing widening of the sandbox. The interface lists rules where the sandbox's state is shown, and a rule is revoked in one click.
- Linux under MXC records hosts only; the interface says that filesystem refusals are not reported there, rather than showing an empty list that reads as "nothing was refused".
