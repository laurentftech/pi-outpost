## 1. Implementation

- [x] 1.1 `sandboxOff` on the unconfined verdict; `confinementOf` gives it when the sandbox is off, the runtime is embedded and a `bash` tool is active.
- [x] 1.2 The lock's description for it: turned off, not confined by pi-outpost, no suggestion.
- [x] 1.3 Tests at the wire and in the component; scenario matrix; the running app.
- [x] 1.4 `config --confine` restores the default sandbox in place of `"sandbox": false`, after the self-check and the canary, and refuses under `rpc`; the sandbox-off lock offers it where the machine can confine.
- [x] 1.5 The command's tests run on the macOS runner job, the one CI host where `"auto"` has a runner — so the success paths (this one and `ConfineOnACapableMachine`) are exercised rather than skipped everywhere.
