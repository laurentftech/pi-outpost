# Proposal: `sandbox doctor` — a paste-safe snapshot of the sandbox's state, probes and recent decisions

Issue #573. Today, when something fails inside the Windows sandbox, nothing inside the sandbox says why:
the active backend/tier, the policy, the env filter, the relays and the recent denials are all invisible
from inside, and "sandbox policy or environment problem?" is settled by a human reconstructing it by hand
(two real incidents in #573: an air-gapped `uv` failure and a junction fix with no observable effect).

## What changes

- **CLI**: `pi-outpost sandbox doctor [--json]` — one command producing a structured snapshot (sections
  below), paste-safe by construction: no environment *values*, no credentials, no home contents — names,
  classes, structure only. An explicit opt-in flag is out of scope for v1.
- **Agent surface**: a built-in read-only `sandbox_doctor` tool returning a *bounded* summary of the same
  snapshot (identity, network, policy counts, link table, last decisions — never environment values), so
  the agent can self-diagnose instead of guessing. Detail sections stay on the host CLI.
- **Decision log**: the per-project rules store already keeps the last ~200 recorded refusals (network
  refusals, filesystem refusals, host questions) with their targets, fed via `onRefusal` where those notes
  are already produced; the snapshot and the tool read that store (`decisionLog`), so the log cannot drift
  from what the agent was told.

## Snapshot sections

1. **Identity**: pi-outpost version, OS/arch, the configured runner, its kind, and — first-class — the
   active MXC tier / enumeration level on Windows.
2. **Policy by class**: read-write / read-only / denied path counts with denial reason classes ("beside the
   way", "sibling of the root", "agent directory", …); the link/junction resolution table (every link the
   policy resolved, its target, which ancestors are enumerable); network policy (egress, private network,
   loopback, allowed hosts as declared); env filter: dropped variable **names** grouped by prefix; grants.
3. **Relays and seeds**: which local relays run (registry, signing) and on which port; which carried
   configurations were written for which package manager — exposing "manager X has no seed".
4. **Probe battery** (host CLI, confined where a runner is available): PATH resolution of `node`, `npm`,
   `python`, `uv`, `git` (resolved / not found / found-but-denied); DNS and reachability of configured
   registries/relay, classified (policy denial vs TCP refused vs DNS — and in air-gapped setups "public DNS
   does not resolve" is *expected*, not a failure); scratch write in the root; the full-path vs by-name
   asymmetry check (the exact #572 symptom). Each probe names the responsible layer.
5. **Decision log**: last ~200 decisions with kind, target class and reason class.

## Safety

- Default output is paste-safe for a public issue: a test asserts a fixture snapshot containing secrets
  leaks none of them.
- Read-only: no "fix" mode in v1 — diagnosing first, so a fix cannot mask the evidence.
- Bounded agent output (summary first, size-capped).
- Non-introspectable backends degrade gracefully and say which sections are unavailable and why.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: a diagnostic surface — CLI snapshot + bounded agent tool + decision log — over the
  sandbox's own state.

## Impact

New `server/src/sandboxDoctor.ts` (collector, renderer, decision-log reader, probe battery), a `sandbox doctor`
CLI command (`cli.ts`, `index.ts`), a `sandbox_doctor` built-in tool (`sandbox.ts`), `activeSigningShim()` in
`terminalSandbox.ts` for the relay section, tests (`server/test/sandboxDoctor.test.ts`), help text,
`docs/sandboxing.md` and `docs/command-line.md` sections.
