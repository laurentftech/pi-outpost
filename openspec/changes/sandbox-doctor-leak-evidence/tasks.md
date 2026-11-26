# Tasks

## 1. Confinement verdict surfaced in the snapshot

- [x] 1.1 Export the attempt-word mapping from `server/src/confinementStatus.ts` (`ATTEMPT_WORDS` or a new `describeAttempt()`), verify a unit test renders `beside-root` as "read a file beside the root"
- [x] 1.2 Add `confinement?: ConfinementVerdict` to `DoctorInput` and a `confinement` section to `SandboxSnapshot` in `server/src/sandboxDoctor.ts`; the CLI branch in `index.ts` fills it via `shellVerdict(config.sandbox, { agentDir, configFile })` (the same path `pi-outpost doctor` uses — auto/unavailable/unconfined included), the agent tool reads `settledShellVerdict` and reports `checking` when unset; verify with tests feeding `leaking`, `failed`, `unavailable` and unset verdicts
- [x] 1.3 Render the section in `renderSnapshot` (early in `boundedAgentSummary`, before the 4000-char cap) with single-line, length-capped `reason`; verify the paste-safety fixture test (`assertPasteSafe`) passes with a `leaking` and a `failed` verdict in the snapshot, and that `--json` exposes `confinement: { state, runner, checkedAt, reached?, reason? }`

## 2. Granted-path classification for PATH probes and link targets

- [x] 2.1 Add a pure `isGrantedPath(p, granted: string[])` / `outsideRootAndUngranted(p, root, granted)` helper in `sandboxDoctor.ts`, where `granted` = readwrite ∪ readonly ∪ enumerated paths of the **runtime** policy request (`policyRequestFor(..., mxcEnumerateLevel())`), including the policy's own tmp; verify with unit tests on Linux CI: `D:\WRK\Scoop\...` granted → ok; ungranted outside-root path → flagged; cross-drive, case and trailing-slash variants (use `path.win32` semantics, `path.join` for fixtures — Windows CI rules from AGENTS.md)
- [x] 2.2 In `runDoctorProbes`, classify each resolved PATH tool with the helper: granted → `ok` (unchanged); outside root and ungranted → `fail (policy)` with detail "resolves outside the root and is not a granted path: …"; verify with a probe test resolving `npm` to an ungranted outside-root path (the #582/#585 shape) asserting fail/policy, and one to a granted Scoop path asserting ok
- [x] 2.3 Add `outsideRoot` and `granted` to `LinkEntry` in `linkTableFor` and render `— OUTSIDE THE ROOT, NOT GRANTED` in `renderSnapshot` (and in `--json`); verify with link-table tests for a flagged ungranted target and an unflagged granted Scoop `current` link

## 3. Single-line probe details + beside-root canary replay probe

- [x] 3.1 Apply a `oneLine()` sanitizer (collapse `\r\n\t`/control chars, cap length after sanitizing) to captured probe output, decision-log lines and verdict reasons, in `runDoctorProbes` and `renderSnapshot`; verify with a test whose relay-probe error output contains a newline mid-URL (the #582/#585 paste) asserting one line with the URL intact
- [x] 3.2 Add the beside-root probe to `runDoctorProbes`: `mkdtemp` under the host tmpdir (the canary's bait location, `confinementCanary.ts`), write a marker, confined read at the proven level (the battery's `agentBashOptions` policy already builds at `mxcEnumerateLevel()`); `ok` when refused, `fail (policy)` naming the bait path when reached; `skipped` with reason when no runner / non-MXC / tmpdir inside the root; verify with probe tests for refused-at-level-2, reached (foreign-drive #585 shape), and the three skip cases; cleanup the marker in a `finally`

## 4. Tests, scenario coverage, docs

- [x] 4.1 Extend `server/test/sandboxDoctor.test.ts` for all new behaviors (leaking/failed/unavailable/checking verdicts, granted vs ungranted PATH resolution, link flags, single-line detail, beside-root probe ok/fail/skipped), with the sibling change's `// openlore: scenario=…` annotations (`server/test/sandboxDoctor.test.ts` already uses them); run the suite via `npm test --workspace server` (sandboxDoctor tests) and verify green
- [x] 4.2 Update `server/test/sandbox-tools.test.ts` expectations for the new snapshot section if they assert on snapshot shape; verify the suite still passes
- [x] 4.3 Write `scenario-coverage.md` in this change mapping every `#### Scenario:` of `specs/sandbox-runner-bash/spec.md` to a test name, classified covered/partial/uncovered, in the sibling change's table format; verify `rg '^#### Scenario:' openspec/changes/sandbox-doctor-leak-evidence/specs/` lists exactly the mapped scenarios and `npm run check:scenarios` passes
- [x] 4.4 Update `docs/sandboxing.md` (`### Seeing the sandbox's own state…`) and `docs/command-line.md` (`### pi-outpost sandbox doctor`) for the confinement-verdict section, the granted-path flags, single-line details and the beside-root probe; verify documented commands match `server/src/cli.ts --help` and add the PR "Documentation impact" note per AGENTS.md

## 5. Validation

- [x] 5.1 Run `openspec validate sandbox-doctor-leak-evidence --strict`, `npm run typecheck --workspace server` (`tsc --noEmit -p tsconfig.test.json`) and `npm run lint --workspace server` (`oxlint src`); verify all pass
- [x] 5.2 Run the sandbox suites — `npm test --workspace server` for `sandboxDoctor`, `sandbox-tools` and the confinement tests — and verify green; new tests must follow the AGENTS.md Windows rules (paths via `path.join`, split on `/\r?\n/`, spawn `npm.cmd` not `npm`)
- [ ] 5.3 Add a Windows/MXC smoke task execution: run `pi-outpost sandbox doctor` on a real Windows MXC host and confirm the confinement section, flags and beside-root probe appear (sibling change's task 8 pattern)

## Workflow follow-up

- Review the change, then implement via the apply workflow.
- After implementation and review, archive the change (`openspec archive`) and sync the delta into `openspec/specs/sandbox-runner-bash/spec.md`.
