# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/sandbox-doctor/` (3 scenarios, `sandbox-runner-bash`).

| Scenario | Status | Evidence |
| --- | --- | --- |
| ASandboxDoctorSnapshot | covered | `server/test/sandboxDoctor.test.ts` (ASandboxDoctorSnapshot): snapshot sections rendered — identity with the active tier first, policy by class with reason classes, env filter as `UV_*: 1 dropped` names-only, link table `current` → target readable, relays/seeds, probes by layer, `--json` shape — plus `collectSandboxSnapshot` end to end on the win32/MXC branch and a paste-safety fixture asserting a secret env value appears nowhere in the output. |
| TheAgentCanRequestABoundedSandboxSnapshot | covered | `server/test/sandboxDoctor.test.ts` (TheAgentCanRequestABoundedSandboxSnapshot): `boundedAgentSummary` is size-capped and keeps identity/network/policy-counts/link-table/last-10-decisions with no env values and no probe execution; the `sandbox_doctor` tool definition test returns exactly that summary, and says so when no runner is configured. |
| SandboxDecisionsAreLogged | covered | `server/test/sandboxDoctor.test.ts` (SandboxDecisionsAreLogged): `decisionLog` reads the per-project rules store (`rulesStoreFor(agentDir, root).refusals()`, cap 200, newest last); a confinedBash-level test with the fake runner wires `onRefusal` to the store and asserts a refused host and a refused write land in the doctor's log with their targets. |
