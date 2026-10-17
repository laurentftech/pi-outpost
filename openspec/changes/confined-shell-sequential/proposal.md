# A confined shell runs a turn's commands in order

## Why

Run against MXC on Windows 11, Codestral asked for "create a file, rename it, delete it" as
three `powershell` calls in one message. pi runs a message's tool calls together
(`toolExecution: "parallel"`), and each confined command first starts a runner, which takes
about a second under MXC: the rename ran while the create still held the file ("used by
another process"), and the delete found nothing. Run one after another, the same steps
succeed. The sandbox was right; the order was not.

## What Changes

- The agent's shell, when a `bashRunner` confines it (`bash` or `powershell`), is declared
  `executionMode: "sequential"`: pi runs a message's calls to it one at a time, in the
  order the model wrote them.
- The unconfined `bash` (`allowBash` without a runner) keeps pi's default.

## Impact

`server/src/sandbox.ts`. Independent confined commands batched in one message no longer
overlap, so such a batch takes the sum of their times. WSLC commands were already queued
one at a time (`WslcRunsOneAtATime`); this extends the order to every runner.
