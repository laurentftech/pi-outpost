# Scenario coverage

`orient` pointed at `server/src/sandbox.ts` (`createSandboxedTools`) and the runner suite
`server/test/sandboxRunnerBash.test.mjs`. Scenarios enumerated with
`rg '^#### Scenario:' openspec/changes/confined-shell-sequential`.

| Scenario | Status | Test file and name |
|---|---|---|
| ATurnsCommandsRunInOrder | covered | `server/test/sandboxRunnerBash.test.mjs`: `ATurnsCommandsRunInOrder: commands batched in one message run one after another, in order` — the real server and agent, a provider that emits both calls in one message, the fake runner; asserts the second command's output reads `made` from the first's file, and that the first's end time is no later than the second's start. Without the fix it fails on the read (`ENOENT`). |
