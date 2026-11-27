# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/windows-strict-denies-on-security-environment-refusal/` (1 scenario, `sandbox-runner-bash`).

| Scenario | Status | Evidence |
| --- | --- | --- |
| StrictDeniesKeepOnlyOpenableEntries | covered | Unit: `server/test/terminalSandbox.test.ts`, "StrictDeniesKeepOnlyOpenableEntries: when the host's security environment refuses a denied path (0x80070005, domain-joined account) …" — with `strictDenies: true`, a denied entry the host cannot open (`D:\WRK\no-such-entry`) is absent from `deniedPaths` while an openable folder (`tmpdir()`) stays denied, and the agent directory (unopenable in the test) is left out; without `strictDenies`, both are kept; the test also asserts that in strict mode the foreign drive's root stays readable while the way down on it is not made readable on top of it. Triggered on the reporter's v0.68.0 machine: `CreateProcessSecurityEnvironment failed (HRESULT = 0x80070005)` at startup with the shell unavailable, after #586 added foreign-drive deny entries to the level-2 policy. |
