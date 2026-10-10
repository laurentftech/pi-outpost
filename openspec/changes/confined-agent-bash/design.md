# Design

## Context

See proposal.md for why. With `allowBash` on and no `bashFrom`, `createSandboxedTools` registers pi's
`createBashToolDefinition(realRoot)`, which runs `command` in a local shell, unconfined. Pi lets the
caller replace how a command runs: `createBashToolDefinition(cwd, { operations })`, where
`operations.exec(command, cwd, { onData, signal, timeout, env })` returns the exit code. Pi's own
implementation (`createLocalShellOperations`) converts `timeout` from seconds, throws `aborted` and
`timeout:<seconds>`, kills the whole process tree, and reports a signal-killed shell as 128 + signal.

The `confined-terminal` change already has everything a policy needs (`server/src/terminalSandbox.ts`):
`checkRunner` (landstrip's `doctor`, MXC's `--probe`), `terminalPolicy` (landstrip), `mxcTerminalConfig`
and `siblingsToDeny` (MXC), `confinedEnvironment`.

Measured on Windows 11 24H2 (26100.9457), one command through `wxc-exec.exe` with pipes: stdout and
stderr come back separately, the exit status is the command's, about 0.13 s per command, and killing the
executor ends the confined command (no `sh.exe` left).

## Goals / Non-Goals

**Goals:**
- The agent's `bash` can never do more than a confined terminal in the same workspace.
- Failing closed: an unusable runner refuses each command; nothing runs unconfined.
- The tool behaves like pi's `bash` for the model: same output, exit status, timeout and abort.

**Non-Goals:**
- A persistent shell between commands (pi's `bash` has none either: each call is a fresh shell).
- Confining extensions, MCP servers or the server itself.
- Choosing a Windows shell for the user: busybox-w32 is documented, not bundled.

## Decisions

### D1. Operations, not a new tool

`createSandboxedTools` keeps registering pi's `bash`, built with `operations` from `confinedBashOperations`.
The tool's schema, prompt, rendering and truncation stay pi's, so the model sees no difference, and
`withCwd` still pins the root.

### D2. One runner launch per command, the command in a script file

Each call creates a private temporary directory, writes the command to `command.sh` there, writes the
policy beside it, and runs `<runner> … <bashShell> <dir>/command.sh`: for MXC `wxc-exec <request>` with
that command line inside the request; for landstrip `landstrip run -p <policy> -- <bashShell> <script>`.
A script file avoids quoting the command through a Windows command line and a shell `-c`. The directory
is the command's `TMPDIR` and is removed when the call ends.

### D3. The terminal's policy, the command's working directory

The policy is built by the same functions, with the same inputs, as a confined terminal in that
workspace: root and writable zone from the sandbox, the agent directory and the configuration file
denied, the script's directory as the temporary directory, and for MXC the deny list beside the path to
the root, read when the command starts. The working directory is the one pi passes (the root, or inside
it); one outside the root is clamped to the root, as for the terminal.

### D4. The terminal's environment

`confinedEnvironment(process.env, { root, tmp, shell })`. Pi's `PI_*` session variables are not passed:
their prefix is shared with the server's own (`PI_OUTPOST_TOKEN`), and building the list beats filtering
it (`confined-terminal` D3).

### D5. Self-check once, refusal per call

`checkRunner` runs once per runner path, on first use, and is cached. A failed check, a missing runner,
or Windows with no `bashShell` makes `exec` throw the reason before anything is spawned. Refusing per call
rather than refusing the session keeps the agent's other tools, and shows the reason where the model and
the user both see it.

### D6. Cancellation and timeout kill the tree

The runner is spawned with pipes, `detached` outside Windows, and killed as a tree on abort or timeout
(`taskkill /T /F` on Windows, the process group elsewhere): the runner supervises the confined process,
and killing it ends the sandbox (measured for MXC). Errors are pi's: `aborted`, `timeout:<seconds>`.

### D7. Configuration

`sandbox.bashRunner` and `sandbox.bashShell` are paths resolved against the configuration file, like
`terminal.sandbox`. Configuration only: Settings do not edit them and carry them over when applying a
sandbox change. `bashShell` defaults to `/bin/bash` outside Windows. Exclusive with `bashFrom`, refused at
load: two answers to "who runs bash" is one too many.

## Risks / Trade-offs

- [MXC tier 1 only lists and enters writable folders] → `ls` or `cd` into a read-only part of the root
  fails. With no narrower writable zone (the usual setup) the whole root is writable and unaffected.
  Documented.
- [Deny list read at launch] → an entry created afterwards beside an ancestor of the root, or a file
  another process holds open at that moment, is not denied. Documented; the fix is microsoft/mxc#1464,
  after which the drive need not be readable at all.
- [busybox is `ash`, not bash] → no `[[ ]]`, arrays or `$'…'`; a model writing pure bash will sometimes
  hit that. Documented; Git Bash waits for microsoft/mxc#1061 and an MSYS2 change.
- [Launch cost per command] → about 0.13 s under MXC; landstrip on Linux is faster. Acceptable for an
  agent's tool call.
- [A `bash` that refuses every call] → visible: the reason is the tool result.

## Migration Plan

Opt-in: install a runner (and busybox-w32 on Windows), set `sandbox.bashRunner` (and `sandbox.bashShell`),
restart. Removing them restores today's `bash`.
