# Tasks

## 1. landstrip's refusals and the startup line

- [x] 1.1 `confinedBash.ts`: `landstripNote` rewrites a landstrip `*_DENIED` info line, and `landstripStderr` buffers landstrip's stderr line by line through it (Linux, landstrip only). Verify `server/test/landstripNotes.test.ts` (split chunks, CRLF, untouched lines, a held last line) and the real-runner `ALandstripRefusalIsToldInWords` in `confinedNetworkLandstrip.test.ts`.
- [x] 1.2 `sandbox.ts` `networkSummary`, used by the startup line in `index.ts`. Verify the `networkSummary` tests in `landstripNotes.test.ts`.
- [x] 1.3 Correct the wording of `AReadableServerEnvironmentIsJudgedByWhatItHolds` (delta spec). The behaviour is unchanged. Verify `openspec validate landstrip-sandbox-notes --strict`.
- [x] 1.4 Write `scenario-coverage.md` and verify `node scripts/check-scenario-coverage.mjs --change landstrip-sandbox-notes`.
