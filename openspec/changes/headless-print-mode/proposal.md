# Proposal

## Why

Driving the agent without a browser — to test a sandbox, a grant, a skill, or to script a task — meant
writing a WebSocket client by hand: start the server, connect, send the prompt, answer dialogs, wait for
the end of the turn, parse the session file. The grants work did exactly that, and kept a bench running
for it. Codex (`codex exec`) and Claude Code (`claude -p`) have a one-shot mode for this.

## What Changes

- `pi-outpost -p "<prompt>"` (or `--print`) runs one turn and exits. The prompt is `-p -` read from
  stdin. It runs **the real server** with the same configuration, sandbox, runner, grants, extensions and
  sessions, bound to `127.0.0.1` on a free port, with no browser and no terminal, and talks to it as the
  interface does. Nothing else needs to run.
- The assistant's answer goes to stdout, streamed. Everything else — the server's log, the tools the
  agent calls, what was asked and answered — goes to stderr. The exit status is 0 for a turn that ended,
  1 for a failed one (a provider error, a refused prompt, no model).
- `--json` prints every event of the turn as one JSON line on stdout instead, for scripts and tests.
- Nobody is there to click, so questions are answered by a declared policy: `--grants refuse|once|session`
  answers grant requests (default `refuse`), and an extension's dialog is declined. Each answer is said
  on stderr.
- `--model <provider/id>` picks the model for the turn.
- `-p` is incompatible with the other commands, and `--json`, `--grants` and `--model` belong to it.

## Capabilities

### New Capabilities

### Modified Capabilities
- `cli`: a one-shot print mode, its flags, its output streams and its exit status.

## Impact

- `server/src/cli.ts`: the flags and the `print` command.
- `server/src/printMode.ts` (new): the client of the turn.
- `server/src/index.ts`: in print mode, bind to a free loopback port, keep stdout for the answer, run the
  turn after `listen`, exit with its status.
- `README.md`: the CLI section.
