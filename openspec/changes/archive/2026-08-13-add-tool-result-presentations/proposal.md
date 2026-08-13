# Change: Add tool-result presentations

## Why

A tool result is shown as a block of text unless `ToolCard` happens to special-case
it. A `grep` sweep, a `git diff`, and an `edit` all carry different information and
should be scanned differently, but only `edit` and `write` get a purpose-built view
today.

### What already exists

This change is a refactor plus an extension, not a greenfield feature. The
starting point:

- **`ToolCard` already dispatches on result shape**, hardcoded inside one
  component (`ui/src/components/ToolCard.tsx:46-68`): `editPairs()` →
  `SplitDiffBlock`, `writeContent()` → `DiffBlock`, `item.outputHtml` →
  `RenderedHtml`, `getFormattedToolOutput()` → markdown, else `<pre>`. That is an
  ad-hoc registry with no seam for a fifth case.
- **`outputHtmlCollapsed` is produced and delivered but never consumed.** The
  server renders it (`server/src/extensionRender.ts:108`, plumbed through
  `server/src/convert.ts:222-225` and `server/src/index.ts:1024`) and the client
  stores it (`ui/src/useAgent.ts:503`), but no component reads it. The collapsed
  preview this change wants is already paid for on the server.
- **Tool identity is stable and closed.** pi-outpost embeds pi as a library and
  substitutes its own sandboxed toolset (`server/src/sandbox.ts:96-131`). The
  identities the UI can rely on are `bash`, `read`, `ls`, `grep`, `find`, `edit`,
  `write` — nothing else.
- **`openspec/specs/components/spec.md` already governs this surface** via
  `ConversationItemRendering` (scenario `ToolOutputUsesSpecializedRenderers`) and
  `SharedPresentationPrimitives` (scenario `RenderExtensionHtml`). This change
  modifies that requirement rather than opening a competing one.

### What is actually missing

A named seam, a collapsed view, and two presentations (`grep`, `git diff`) that
the existing primitives can already draw.

## What changes

- **Extract** the dispatch currently inlined in `ToolCard` into a presentation
  registry: one module that maps a completed tool call to at most one renderer,
  with deterministic priority and a raw fallback. `ToolCard` becomes a consumer of
  the registry, not a competitor to it — there is exactly one dispatch path
  afterwards.
- **Add a common result card** carrying status, the raw input, and a guaranteed
  raw-output fallback, so provenance survives every specialized view.
- **Wire `outputHtmlCollapsed`** into the collapsed state of the result card,
  replacing the unconditional `getFormattedToolOutput()` path when an extension
  supplied a collapsed rendering.
- **Deliver two presentations in this change**: code search (`grep`) and Git diff
  (`bash` whose command is a `git diff` / `git show` invocation).
- **Let a presentation expose contextual actions**, drawn from a closed enumeration
  of `useAgent` actions that already exist — `readFile`, `fetchGitDiff`,
  `fetchGitFileHistory`, `searchFiles`, `prompt`. A presentation cannot construct
  a new wire message and cannot execute a tool.
- **Keep extension-rendered HTML on its existing trusted channel**, and state that
  trust boundary explicitly rather than implying tool output and extension output
  are the same thing. See `design.md`.

## Deferred, with reasons

- **Test-result presentation.** There is no test tool identity — a test run arrives
  as `bash`, so matching means sniffing a command string and parsing arbitrary
  runner output (vitest, jest, pytest, go test, …). High cost, brittle, and the
  matcher set cannot be closed. Revisit if pi ships a dedicated test tool, or scope
  it to this repo's own `vitest` invocation as a separate change.
- **Delegated-agent presentation.** There is no delegated-agent concept in the
  protocol or the toolset — `shared/src/protocol.ts` has no sub-agent item and
  `server/src/sandbox.ts` exposes no spawn tool. The presentation has no data
  source. Cut until one exists.

## Non-goals

- Replacing the conversation transcript or changing the tool-call protocol.
- A user-installable renderer/plugin marketplace.
- Rendering arbitrary HTML, JavaScript, or remote URLs originating in **tool
  output**. (Extension-rendered HTML is a separate, pre-existing channel — see
  `design.md`.)
- Adding a per-tool-call approval prompt. None exists today; tools run unattended
  inside the sandbox configured by `updateConfig`. Introducing one is its own
  change.
- Automatically applying changes suggested by a result.

## Impact

- **Affected capability**: `tool-result-presentations` (new).
- **Modified capability**: `components` — `ConversationItemRendering` is rewritten
  so `ToolCard` delegates to the registry instead of enumerating renderers itself.
- **Affected code**: `ui/src/components/ToolCard.tsx` (loses its dispatch),
  new `ui/src/presentations/*`, `ui/src/util/toolOutput.ts` (becomes one
  registered presentation among several rather than a privileged path).
- **Affected contracts**: none on the wire. The tool-call view model gains
  UI-only presentation metadata; `toolName`, `args`, `output`, `outputHtml`,
  `outputHtmlCollapsed` are unchanged.

## Risks

- **Selection instability during streaming.** Output arrives after the card mounts
  (`ui/src/components/ToolCard.tsx:63-65` already resynchronizes `open` for this
  reason). If the registry re-selects when output lands, cards change renderer and
  collapse under the cursor. Mitigated by requiring selection to be a pure function
  of `(toolName, args)` where possible, and forbidding a running→done transition
  from narrowing an already-chosen presentation.
- **Fallback must be total.** An unknown or malformed result must never hide data.
  Covered by an explicit requirement and unit tests.
- **Two dispatch systems.** Mitigated by deleting the inline branches in `ToolCard`
  in the same change, not alongside it.
