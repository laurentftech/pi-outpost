## Context

See proposal.md — Why. Two facts about the code shape the approach.

`server/src/index.ts` is a top-level module with top-level `await`. `await app.listen({
port: PORT, host: HOST })` sits at line 733 with nothing around it, so its rejection is an
unhandled rejection: Node prints a trace and exits. Every other failure in the same file
already has a house style — `complain(error)` at line 148, which prints one line and
prefixes it `[pi]` unless the message brings its own bracket, followed by `process.exit`.
`init` and `build-exe` both use it. This change joins that path; it does not invent one.

The second fact is about where the message lands. A process started from a file manager on
Windows *owns* its console window: the window exists because the process does, and it
closes when the process exits. There is no scrollback to go back to and no terminal that
outlives it. A process started from a shell borrows a console that belongs to the shell,
and its output survives it. The same `console.error` call is therefore permanent in one
case and a flash in the other, and nothing in the message itself can tell the difference.

## Goals / Non-Goals

**Goals:**

- A failure to bind reads like every other startup failure this binary has.
- The message reaches an operator who has no terminal — the case the own-window change
  created and the reason this is worth doing now.
- The decision about whether to hold the console is a value a test can compute, not a
  behaviour a test has to observe through a keypress.

**Non-Goals:**

- Recovering from the failure — retrying, scanning for a free port, or joining a server
  already running. See proposal.md — Out of scope.
- Anything on the success path. A server that binds must not gain a line of output, a
  prompt, or a millisecond.
- Failures after `listen` succeeds. A stalled extension binding leaves the process alive
  and is a different change.

## Decisions

**Catch at the call, not with a global handler.** An `unhandledRejection` handler would
also catch a failure this file has not thought about, and would report it as if it had.
The point of the message is that it knows what failed; a `try`/`catch` around the one
statement keeps that true. Alternative considered: a process-wide handler, which is fewer
lines and turns every future unknown failure into a confident sentence about the wrong
thing.

**Two pure functions and one impure edge.** The message is a function of the error, the
host and the port. Whether to hold the console is a function of the platform, the
environment, and who the parent process is. Both are exported and tested directly; only
the keypress wait touches the terminal. This mirrors `openBrowser.ts`, where
`shouldOpenBrowser` and `browsableUrl` are pure and the spawn is the thin part — the same
shape, for the same reason: the interesting question is the decision, and a decision is
cheap to test everywhere and expensive to test through its effect.

**Ask who the parent is, rather than whether a terminal is attached.** `process.stdin.isTTY`
is true both for a double-clicked window and for a shell, so it cannot separate the two
cases; it only says a person could type. The question that matters is whether this console
dies with this process, and that is answered by the parent: a console spawned by the file
manager has `explorer.exe` above it, a shell has the shell. On Windows the parent's image
name comes from `tasklist /FI "PID eq <ppid>" /FO CSV /NH`, run once, only on the failure
path, and only there — the success path never pays for it, and a fatal error can afford a
process spawn. `/FO CSV /NH` because `tasklist`'s headers are localised and its default
layout is column-aligned; the image name itself is not localised.

Alternative considered and rejected: hold whenever `stdin` is a TTY and `CI` is unset, with
a timeout so a wrong guess cannot hang. Five lines instead of thirty, no spawn, no parsing.
Rejected because it makes an interactive shell user press a key on an error they can
already read, and because the timeout is a second guess layered on the first — if the
signal were right, no bound would be needed.

**Hold only on a confident yes.** The probe answers `explorer.exe`, something else, or
nothing at all — no parent, a probe that failed, a platform with no `tasklist`. Only the
first holds the console. Everything else exits immediately, which is exactly today's
behaviour, so a probe that cannot answer degrades to what already happens rather than to a
process that hangs. `CI` is checked first and never holds, on the same reasoning
`shouldOpenBrowser` already applies to it: a runner has no one watching.

**Wait for a key, not for a timeout.** Once the answer is a confident yes, the window is
the operator's only copy of the message and there is no honest number of seconds after
which it should be thrown away. `setRawMode(true)` and the first byte on `stdin` ends it.
Where raw mode is unavailable the wait is skipped rather than degraded into a hang.

**Exit non-zero, with the code the file already uses.** `1`, as `init` and `build-exe`
use for their failures. `2` is taken by argument parsing and means "you typed something
wrong", which this is not.

## Risks / Trade-offs

**A wrong parent probe holds a window nobody is watching** → It can only hold when the
parent is `explorer.exe`, and a process whose parent is the file manager has, by
construction, a console of its own that would otherwise vanish. A wrong answer in the other
direction — failing to recognise a launch that owns its console — loses the message, which
is today's behaviour and not a regression.

**`tasklist` is absent or restricted on a hardened Windows** → The probe returns no answer,
the process exits immediately, and the operator is exactly where this change found them.
No path treats a failed probe as a yes.

**A spawn on the failure path costs time** → Only on the path that ends in `exit`, and only
on Windows. Nothing measures a process that is already dead.

**The occupied-port test binds a real port** → Bind port 0 first, read back what the
operating system chose, and start the server against that. Never a fixed number: a test
that hard-codes 3141 fails on the machine of anyone who has the interface open, which is
everyone working on this.

## Migration Plan

None. No configuration key, no flag, no stored state, no protocol message. The change is
visible only on a path that previously ended in a stack trace.

## Open Questions

None.
