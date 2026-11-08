# First full Linux trial: incomplete collection

Run: https://github.com/laurentftech/pi-outpost/actions/runs/42517067149

Commit: `02ebf4e2bbf9230ccff4b921684a0fb61dd7c2c8`; Node 24.22.2.
The job completed in 44m25s and failed its collection-integrity check, not its tests.

- Server: 4,910 passed, 11 skipped, zero failed; 2,479.5 seconds.
- UI: 2,673 passed across 135 files; 80.6 seconds including runner startup.
- Expected process/suite records: 728. Two server entry-point dumps were absent
  (`node-16179`, `node-17282`). Their individual test ownership was not recorded,
  so the exact cause cannot be established from the uploaded artifact.

The reference Linux CI run 42509373874 took 956.8 seconds for the server tests
and 120.55 seconds for Vitest's UI phase. The trial server phase was 2.59 times
slower. The UI phases use different coverage/reporting pipelines, so these are
observations rather than a controlled benchmark. The usual complete Linux job
took 25m02s and includes checks outside this trial's scope.

## Provisional measurements

These counters are incomplete and must not be used as a passing OpenSSF claim.
The inventory includes unloaded handwritten source files at zero; the report
explicitly lists exclusions and unmeasured production workspaces.

| Scope | Statements | Branches |
|---|---:|---:|
| server | 14,987/17,031 (87.99%) | 10,462/13,173 (79.42%) |
| shared | 6,553/6,977 (93.92%) | 5,158/5,995 (86.03%) |
| ui | 8,640/9,315 (92.75%) | 7,430/8,532 (87.08%) |

## Follow-up needed before adoption

The real harness permits 300ms between SIGTERM and forced SIGKILL when the V8
coverage sink is absent. This trial deliberately disables that sink and relies
on a synchronous SIGTERM snapshot. A snapshot delayed or interrupted beyond
that allowance is one plausible explanation, not a proven cause.

Record test ownership and shutdown status alongside expected process markers,
and exercise slow flush / signalled / failed-start paths before another full
run. Preserve the strict missing-dump failure. A successful test suite alone
does not establish complete coverage collection.

The experiment supports keeping any eventual statement measurement separate
from PR checks. No daily schedule, production threshold or OpenSSF response
has been changed. All trial work remains in the isolated experiment worktree.
