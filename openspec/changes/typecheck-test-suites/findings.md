# Test typing findings

The fixes distinguish stale calls, incomplete fakes, missing declarations and strictness
narrowing. No product behaviour is changed to accommodate a test.

| Test | Finding and correction |
| --- | --- |
| `server/test/git-optional-locks.test.ts`, “a write goes through while this application is reading” | `gitLog` received an array instead of its repository. The read now targets the fixture repository. |
| `server/test/sessions.test.ts`, “skips tool calls between user and assistant” | The fabricated `tool_call` session entry does not exist in the current SDK. Use a real `message` / `toolResult` entry between the messages. |
| `ui/src/useAgent.test.ts`, “queues dialogs and drops the answered one” | A confirmation answer used the obsolete `result` field. Send the actual protocol's `confirmed` field. |
| `ui/src/useAgent.test.ts`, “does not set progress from a text-only tool_update” | The union was not narrowed. Also assert tool identity, updated output and running state before checking absent progress, so a missing tool or ignored update cannot pass. |
| `e2e/openwebui-posters.spec.ts` | The fake configuration used nonexistent identity mode `headers`. The header-based mode is `plain`. |
| `server/test/structuredExchangeV2Schema.test.ts` | TypeBox diagnostics expose `instancePath`, not `path`; failure diagnostics now print the actual location. |

Other changes complete fixtures (model names, reasoning support, tool call IDs, text,
plan evidence, login flow identity and required callbacks), narrow discriminated unions,
or type JavaScript support modules. The harness uses `ServerMessage`, including predicate
type guards, instead of an open-ended `any` record. JavaScript remains the source of truth
for those declarations; compilation alone cannot prove their accuracy.

The progress-demo fixture now follows the actual tool contract (`label`, result `details`;
partial updates are identified by the update callback, not an extra result field).

## Can the corrected assertions fail?

Verified on 2026-11-07 using isolated copies of the production modules and test files:

- Enable optional Git locks: “a status leaves the index exactly as it found it” fails
  on the index modification time.
- Accept a tool result as the first assistant reply: “skips tool calls between user
  and assistant” fails because `assistant: Done!` is absent.
- Force an outbound confirmation to false: “queues dialogs and drops the answered
  one” fails on the exact `extension_ui_response` frame.
- Invent progress zero for a text-only update: “does not set progress from a text-only
  tool_update” fails on the undefined-progress assertion.

All four expected failures were observed. Temporary copies were removed, and the actual
production modules were never changed for these controls.
