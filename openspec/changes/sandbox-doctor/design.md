# Design: the sandbox reports its own state, read-only, paste-safe

## Mechanism

- **`server/src/sandboxDoctor.ts`** owns everything:
  - `decisionLog(agentDir, root, limit)` — reads the per-project rules store
    (`rulesStoreFor(agentDir, root).refusals()`, cap 200, newest last), which `confinedBash.ts` already
    feeds via `onRefusal` exactly where the refusal notes are emitted (network note, host refusal note,
    landstrip refusals, refused-directories note): the doctor reads that store instead of keeping a
    second log that could drift from what the agent was told.
  - `collectSandboxSnapshot(input)` — builds the sections. Identity from the running process and config.
    Policy by class by building the same MXC request a command gets (`agentBashOptions` +
    `confinedEnvironment` + `mxcTerminalConfig`) and summarizing it: path classes with denial reason
    classes, the link table from the tools/link-target walk, network keys, and the env filter computed by
    diffing the server's env keys against the confined env's keys — names only, grouped by prefix. Relays
    from the live registry/signing relay state and the carried-config list. Probes only when a runner can
    confine: a bounded battery through `confinedBashOperations`, each result naming its layer.
  - `renderSnapshot(snapshot, { json })` — full text/JSON for the CLI; `boundedAgentSummary(snapshot,
    maxChars)` — identity + network + policy counts + link table + last 10 decisions, size-capped, for the
    agent tool. A single `assertPasteSafe(text, secrets)` helper is used by the tests.
- **CLI** (`cli.ts`, `index.ts`): `pi-outpost sandbox doctor [--json]` — a new `sandbox` command whose
  only subcommand is `doctor`. Runs after config load (it reports the loaded configuration, like `config`).
- **Agent tool** (`sandbox.ts`): `sandbox_doctor`, read-only, no parameters, returns the bounded summary.
  Registered with the sandboxed toolset; never replaces a built-in.
- **Probes** (host CLI only): PATH resolution per common tool via `Get-Command` in the confined shell
  (classified resolved / not-found / refused by the sandbox's own note), scratch write in the root, relay
  reachability, and the full-path vs by-name asymmetry on the first resolved tool's folder. Skipped with a
  stated reason when no runner is available. DNS/registry reachability classifies policy-denial vs
  refused vs DNS-failure, and treats "public DNS does not resolve" as expected in air-gapped setups.

## Security

- Paste-safe by construction: env *values* never enter the snapshot (only key names, grouped); grants are
  listed as paths+access, never their content; decisions carry target *classes* (host name / path), never
  file contents or credentials. `--json` is the same data, not more.
- Read-only: nothing in the doctor mutates sandbox state; there is no fix mode in v1.
- The agent tool gets the bounded summary only — no probe execution, no full denied-path dump.

## Known limits, kept

- v1 probes run on the host CLI only; the agent tool reuses the last collected probe results if present,
  else says to run the CLI on the host.
- Backends whose state is not introspectable report their sections as unavailable with the reason —
  "this backend does not expose its policy" is itself a diagnostic result.
