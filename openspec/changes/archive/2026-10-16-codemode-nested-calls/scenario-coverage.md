# Scenario coverage: codemode-nested-calls

Intent: one compact parent card, with all details after expansion. The existing
implementation forwarded nested SDK/RPC events as model calls and discarded partial
render metadata. OpenLore orient was run; its graph index was unavailable, so targeted
`rg` inspection of both runtimes, rendering, protocol, conversion and UI supplied the
implementation evidence. The delta reconciles the requested behavior with that evidence.

Inventory verified with `rg '^#### Scenario:' openspec/` and a focused enumeration
of the main and delta tool-result-presentations specs. Rows below cover every delta
scenario and the main scenarios affected by streaming, rendering and registry priority.
Search/Git navigation, the action enumeration, raw-output security and specialized
search/Git layouts are unchanged by this change and are outside its applicable surface.

| Scenario | Status | Test file and test name / boundary |
|---|---|---|
| AScriptsCallsAreNotTheModels | covered | `server/test/codemodeNestedCallsWire.test.mjs`: `AScriptsCallsAreNotTheModels: one card for the codemode call, which lists the script's calls`; asserts the complete wire event inventory, both reads, the refused path and no outside content. `server/test/pi-rpc.test.ts`: `keeps nested RPC executions inside the parent result`, including start/update/end. |
| AScriptsCallsShowWhileItRuns | covered | `server/test/codemodeNestedCallsWire.test.mjs`: `AScriptsCallsShowWhileItRuns: the codemode card lists the calls before the script has finished`; rendered read occurs before tool_end. `scripts/probes/codemode-nested-calls-ui.mts`: real browser DOM and WebSocket frames while a delayed read is still executing. |
| AScriptsCallsReadTheSameAfterAReload | covered | `server/test/codemodeNestedCallsWire.test.mjs`: `AScriptsCallsReadTheSameAfterAReload: a client connecting afterwards sees the same single card`; asserts exact completed HTML equality and one persisted card. `scripts/probes/codemode-nested-calls-ui.mts`: reload during a second execution and after completion, both persisted cards list the refused read after expansion. |
| ACodemodeCardStartsCompact | covered | `ui/src/components/ToolCard.presentation.test.tsx`: `ACodemodeCardStartsCompact: hides every detail until expanded and keeps the user's choice through updates`; `scripts/probes/codemode-nested-calls-ui.mts`: actual folded DOM excludes script and results, expansion reveals them, six rapid toggles preserve expansion, and reloaded cards start folded. |
| Output arrives after the card is shown | covered | `ui/src/components/ToolCard.presentation.test.tsx`: `does not swap renderer when the output of a running call lands` and `ACodemodeCardStartsCompact: hides every detail until expanded and keeps the user's choice through updates`; running-app rapid toggles exercise this during partial updates. |
| A structured summary becomes available | covered | `ui/src/presentations/registry.test.ts`: `widens the raw fallback once output gives something better to show`. |
| An extension rendering arrives with the output | covered | `ui/src/presentations/registry.test.ts`: `yields to an extension rendering that arrives after the choice was made`. |
| ValidEnvelopeSelectsItsPresentation | covered | `ui/src/presentations/StructuredExchangeView.test.tsx`: `selects the structured presentation for a validated envelope`. |
| DeclaredDataOutranksAnInferredShape | covered | `ui/src/presentations/StructuredExchangeView.test.tsx`: `outranks a presentation that infers its shape from output`. |
| ExtensionRenderingStillWins | covered | `ui/src/presentations/StructuredExchangeView.test.tsx`: `does not outrank an extension's own rendering of its tool`, plus `sits below the extension entry and above every shape guess`, checked against all extensionOwned entries of the production registry. |
| InvalidEnvelopeUsesTheNormalFallback | covered | `ui/src/presentations/StructuredExchangeView.test.tsx`: `ignores an envelope that does not validate, falling back as usual`. |

Additional failure checks: partial renderer exceptions fall back without throwing;
partial contexts carry the script arguments and isPartial=true without starting terminal
timers; text-only updates preserve rendered HTML; completion replaces it. All new paths
use path.join/path.resolve; the outside-read fixture includes a path containing spaces.

Documentation impact: README.md describes the folded codemode card and its nested calls.
No other relevant user/developer document describes a conflicting codemode card behavior.
