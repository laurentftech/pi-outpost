# Spec Delta

## ADDED Requirements

### Requirement: ASandboxDoctorSnapshot

`pi-outpost sandbox doctor [--json]` SHALL print one structured snapshot of the sandbox's state: identity
(pi-outpost version, OS/arch, configured runner, active MXC tier/enumeration level), policy by class (path
classes with denial reason classes, the link/junction resolution table, network policy, dropped env
variable names grouped by prefix, grants), running relays and carried seeds, a probe battery whose results
each name the responsible layer, and the last ~200 recorded decisions with reason classes. The default
output SHALL be paste-safe: no environment values, no credentials, no file contents.

#### Scenario: ASandboxDoctorSnapshot
- **GIVEN** a project with `sandbox` configured (MXC on Windows 11) and the server's environment holding a secret variable (e.g. `UV_INDEX_PASSWORD`)
- **WHEN** `pi-outpost sandbox doctor` runs (and `--json`)
- **THEN** the snapshot names the active backend and tier first, lists the env filter as `UV_*: 1 dropped` (the name, never the value), the link table shows `current` → its target as readable, the probe battery classifies each result by layer, and a fixture test asserts no secret value appears anywhere in the output

### Requirement: TheAgentCanRequestABoundedSandboxSnapshot

A sandboxed session SHALL have a read-only `sandbox_doctor` tool returning a size-capped summary of the
snapshot (identity, network, policy counts, link table, last decisions) — never environment values, never
probe execution — so the agent can tell a policy decision from an environment problem without leaving the
sandbox.

#### Scenario: TheAgentCanRequestABoundedSandboxSnapshot
- **GIVEN** a confined agent session with the `sandbox_doctor` tool active
- **WHEN** the agent calls `sandbox_doctor`
- **THEN** it gets the bounded summary (identity with the active tier, network line, policy counts, the link table, the last 10 decisions), capped in size, with no environment values; with no runner available the tool says so instead of guessing

### Requirement: SandboxDecisionsAreLogged

The server SHALL keep a ring buffer of the last ~200 sandbox decisions (network refusals and host questions,
filesystem refusals) with kind, target class and reason class, recorded where the corresponding note is
emitted to the agent; `sandbox doctor` and the `sandbox_doctor` tool SHALL read it.

#### Scenario: SandboxDecisionsAreLogged
- **GIVEN** a command whose connection the sandbox refused, and one whose file write was refused
- **WHEN** the notes are emitted and `pi-outpost sandbox doctor` runs
- **THEN** the decision log's last entries include both, with their reason classes, and never a credential or file content
