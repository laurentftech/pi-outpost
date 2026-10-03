## 1. Workaround

- [x] 1.1 Confirm against a real Prime Agent 0.9.7: an abort during an `ipython` call makes every plain `prompt` fail as suspended; a `prompt` with `streamingBehavior` is admitted, runs a turn and lifts the suspension; `resume_queue` answers `Unknown command` over RPC.
- [x] 1.2 Resend a prompt refused as suspended once with `streamingBehavior`, and nothing else (spec: APromptAfterAnAbortResumesThePrimeQueue, OnlyTheSuspendedRefusalIsResent).
- [x] 1.3 Model the suspension in the fake child (`suspendsQueueOnAbort`).

## 2. Running app

- [x] 2.1 Drive pi-outpost against a real Prime Agent with Playwright: a prompt that calls `ipython`, Stop while it runs, then a new message, which is answered.
