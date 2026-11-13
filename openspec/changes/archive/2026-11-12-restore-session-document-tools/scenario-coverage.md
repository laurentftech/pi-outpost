# Scenario coverage

| Scenario | Status | Evidence |
| --- | --- | --- |
| A PowerPoint extraction survives session resume | covered | `server/test/documentToolResume.test.mjs`, "a resumed PowerPoint tool survives four quiet turns and a direct call reactivates an expired tool"; `e2e/document-tool-resume.spec.ts`, "Reuse the tool after four exchanges and a session reload extracts the presentation again": drop file, four exchanges, switch saved session, reload page, repeat identical extraction and assert slide text plus declared schema. |
| Resume preserves expiry and branch isolation | covered | `server/test/documentToolState.test.ts`, "resume preserves four idle turns, expires at five, and a call resets the count", "an unused mention, new branch and unrelated calls restore no extractor", and "compaction preserves calls on the branch and naming the file resets its clock". |
| An expired extractor is reused without a search | covered | Same wire and browser tests: five idle turns, assert schema hidden, call without searching, assert extracted slide text and schema present on next request. |
| Direct reuse preserves refusals | covered | Same wire test: invented tool returns not found; PowerPoint path outside root returns sandbox refusal. The additional wire test "direct reuse cannot revive a tool excluded by the configured allowlist" verifies configuration restrictions. Existing deferred-tool suite verifies noExtensions and RPC search behavior. |

Validation: 18 focused unit/wire tests passed; the Chromium scenario passed with a real file drop, saved-session selection, page reloads, expiry and a fresh-session isolation check. Server typecheck and strict OpenSpec validation passed. Baseline reproduction fails at "resumed tool declared before request"; the original expired-call path also returned "Tool pptx_extract not found".
