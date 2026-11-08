# Scenario coverage — landstrip-sandbox-notes

The real-runner test ran locally under landstrip 0.20.26 (Ubuntu 24.04, WSL2), and runs in CI's
Linux job (`LANDSTRIP_BIN`).

## Capability: `sandbox-runner-bash` (4 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| AReadableEnvironmentWithoutSecretsKeepsTheLock | covered | Wording only; the tests are unchanged. `server/test/confinementCanary.test.ts` — "AReadableEnvironmentWithoutSecretsKeepsTheLock: only the server's process environment readable, and it holds no secret" (`verified`, `environmentReadable`). `ui/src/components/ConfinementLock.test.tsx` — "AReadableEnvironmentWithoutSecretsKeepsTheLock: closed, saying the environment is readable and holds no secret" |
| SecretsInAReadableEnvironmentAreNamed | covered | Wording only. `server/test/confinementCanary.test.ts` — "SecretsInAReadableEnvironmentAreNamed: partial, naming the variables; …". `ui/src/components/ConfinementLock.test.tsx` — "SecretsInAReadableEnvironmentAreNamed: amber, partly confined, naming the variables and never a value". `server/test/doctor.test.ts` — the `partial` verdict is `warn`, holding `OPENAI_API_KEY` |
| ALandstripRefusalIsToldInWords | covered | `server/test/confinedNetworkLandstrip.test.ts` — "ALandstripRefusalIsToldInWords: …" under the real runner: `probe-done` printed, the write beside the root refused, the output holds `[sandbox] refused bind [::1]:0: outside what this sandbox allows. The command went on` and `[sandbox] refused write <path>`, no `_DENIED` or `"kind":`, exit status 0. `server/test/landstripNotes.test.ts` — "landstripNote" (the line's wording; program output, other JSON, non-refusals and broken JSON left alone) and "landstripStderr" (a refusal split across chunks rewritten once, CRLF, order kept, a held last line written at the end) |
| TheStartupLineSaysAnEmptyListAsks | covered | `server/test/landstripNotes.test.ts` — "networkSummary": "an empty list under host questions asks about every host; without questions it is closed", and "a list names its hosts, …; no list says nothing". `server/src/index.ts` prints `networkSummary(config.sandbox)` on the sandbox line |
