# Scenario coverage — confined-agent-bash

Capability: `sandbox-runner-bash` (5 new requirements, 10 scenarios). Two kinds of evidence:

- **Fake runner** (every host, CI included): node plays the runner — `server/test/confinedBash.test.ts`
  for the operations, `server/test/sandboxRunnerBash.test.mjs` for a real server and a real agent whose
  provider calls `bash`. They prove what pi-outpost asks of the runner and how it treats the answer.
- **Real runner** (Windows 11 tier 1, where `MXC_EXEC` and `MXC_SHELL` are set): MXC's `wxc-exec.exe`
  with busybox-w32 — `server/test/confinedBashMxc.test.ts`, and the last test of
  `server/test/sandboxRunnerBash.test.mjs`, end to end through the agent. They prove what is confined.
  Run on Windows 11 Home 24H2, build 26100.9457, on 2026-10-10: all pass. No CI runner has tier 1 yet,
  so CI skips them with the reason.

## sandbox-runner-bash

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| BashRunnerAndBashFromAreExclusive | covered | `server/test/config.test.ts` — "a runner for bash and an extension supplying bash are refused together, and empty values alone". Both together throw, naming `sandbox.bashRunner` and `sandbox.bashFrom`; empty values throw too. |
| TheRunnerPathIsResolved | covered | `server/test/config.test.ts` — "bash's runner and shell are absent until configured, and resolved against the config file". Relative values load as `path.join(dir, …)`; absent stays undefined. |
| ACommandCannotReadOutsideTheRoot | covered | `server/test/confinedBashMxc.test.ts` — "reads outside the root are refused, and nothing of them comes back": `cat` of a sibling project's file and of the agent directory's key file exit non-zero, `Permission denied`, and neither content appears. `server/test/sandboxRunnerBash.test.mjs` — "under MXC, the agent's bash cannot read beside the root…": the same through the real agent; the tool result holds `Permission denied`, `exit=1`, and not the secret. |
| ACommandWritesOnlyInTheWritableZone | covered | `server/test/confinedBashMxc.test.ts` — "writes land in the writable zone and are refused elsewhere in the root": the file in `app/out` exists with its content (read back from disk); the write in `app` exits non-zero and the file does not exist. |
| OutputAndExitStatusComeBack | covered | `server/test/confinedBash.test.ts` — "both outputs and the exit status come back…": stdout and stderr both received, exit 3, through the runner with the policy file. `server/test/confinedBashMxc.test.ts` — "both outputs and the exit status come back; pipes, /dev/null and git work": exit 3, both outputs, a pipe's output, `git rev-parse` answering `true` under busybox. |
| CancellingACommandEndsIt | covered | `server/test/confinedBash.test.ts` — "an abort or a timeout ends the command and its runner, with pi's errors": abort rejects `aborted` within the deadline and the shell's own pid is gone; a 1 s timeout rejects `timeout:1`. `server/test/confinedBashMxc.test.ts` — "an abort or a timeout ends the confined command promptly": `sleep 60` aborted after 1.5 s rejects `aborted`, the number of `sh.exe` processes is back to what it was; a 2 s timeout rejects `timeout:2`. |
| KeysDoNotReachTheAgentsCommands | covered | `server/test/confinedBash.test.ts` — "the server's keys do not reach the command; its home is the root" (the command and the runner both lack `OPENAI_API_KEY`). `server/test/confinedBashMxc.test.ts` — "the server's keys are not in the command's environment" (`env` under MXC). `server/test/sandboxRunnerBash.test.mjs` — "the agent's bash runs through the named runner, without the server's keys" (server started with the key; the tool result says `key=none`). |
| AMissingRunnerRefusesTheCommand | covered | `server/test/confinedBash.test.ts` — "a missing runner refuses the command with a reason naming it; nothing runs" (the real self-check; the marker file the command would write does not exist). `server/test/sandboxRunnerBash.test.mjs` — "a missing runner: the session starts, and bash refuses with a reason naming the path" (the session answers, the tool result names the path, the command's output is absent). |
| AFailedSelfCheckRefusesTheCommand | covered | `server/test/confinedBash.test.ts` — "a failed self-check refuses the command with the runner's reason; nothing runs": the reason is in the error and the marker file does not exist. |
| ApplyingSettingsKeepsTheRunner | covered | `server/test/sandboxRunnerBash.test.mjs` — "ApplyingSettingsKeepsTheRunner: a Settings apply leaves bash in the runner": after an acknowledged `update_config` that turns `allowWrite` off, the rebuilt session's `bash` still runs through the runner (`via-the-runner` in the tool result). |

## Running app

The built web UI, served by this branch's server on Windows 11 24H2 (build 26100.9457), with
`sandbox.bashRunner` naming MXC's `wxc-exec.exe` and `sandbox.bashShell` busybox-w32, on a git project
beside a file it must not read. Driven with Playwright (prompt typed in the composer, Send clicked).

- **Real models**: Mistral answered 429 (rate limited) and OpenRouter 402 (no credits left) — no turn
  completed with a real model. The tool is pi's own `bash`, so what a real model would call is the same
  tool; what was left to check is the wiring, done next.
- **Scripted model** (`server/test/fixtures/bash-call-provider.mjs`, loaded as an extension), server
  started with `OPENAI_API_KEY` set. The tool result the model received:
  `cat: can't open 'C:/mxc-lab/sibling-secret.txt': Permission denied` / `read-exit=1` / `8c39b39 init`
  (git log) / `no-keys` / `written-by-agent` / `can't create C:/mxc-lab/escape.txt: Permission denied` /
  `escape-exit=1`. On disk: `from-agent.txt` exists in the project, `escape.txt` does not exist.
- **Breaking it**: `sleep 30` stopped with the UI's Stop button while it ran: two confined `sh.exe`
  during the command, none 1.5 s after Stop, the UI idle again 252 ms after the click, "This operation
  was aborted" on the tool card. A second turn sent straight away ran and stopped the same way.
- **Found and fixed**: the startup log said `bash (UNCONFINED)` with a runner configured (and with
  `bashFrom`). It now names the runner and the shell; `sandboxRunnerBash.test.mjs` asserts it.
