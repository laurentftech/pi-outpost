# Design: tool-result presentations

## Context

`ToolCard` is the only renderer of tool results. It branches on tool name and
result shape inline, and every new case widens the same component. This design
names the seam, fixes the matcher set, and states the HTML trust boundary that
the previous draft left implicit.

## Decision 1 — matching is a closed table, not a heuristic search

The previous draft said selection uses "a stable tool identity and, when
necessary, a validated result shape". That defers the hard part. pi-outpost
substitutes its own toolset (`server/src/sandbox.ts:96-131`), so the identity set
is closed and can be written down:

`bash` · `read` · `ls` · `grep` · `find` · `edit` · `write`

Matchers, in priority order. First match wins; ties are impossible because the
table is total and ordered.

| Priority | Presentation | Match condition | Renders with |
|---|---|---|---|
| 1 | Extension-rendered | `item.outputHtml` present | `RenderedHtml` (existing) |
| 2 | File edit | `toolName === "edit"` and `args.edits` has ≥1 `{oldText,newText}` pair | `SplitDiffBlock` + `diffLines` (existing) |
| 3 | File write | `toolName === "write"` and `args.content` is a string | `DiffBlock` (existing) |
| 4 | Git diff | `toolName === "bash"` and `args.command` matches `/^\s*git\s+(diff|show)\b/` | `DiffBlock` + `diffLines` (existing) |
| 5 | Code search | `toolName === "grep"` | new hit-list renderer |
| 6 | Render envelope | output carries a `__pi_render.text` envelope | `ReactMarkdown` (existing) |
| 7 | Orient summary | output carries the openlore `orient` field shape | `ReactMarkdown` (existing) |
| 8 | Raw | always | `<pre>` (existing) |

Priorities 1–3 and 6–8 are today's behaviour in `ToolCard`, relocated. Only 4 and
5 are new.

Rows 6 and 7 are one function today (`getFormattedToolOutput`), which is why they
were one row in the first draft. See decision 6.

Rows 4 and 5 are the only judgement calls. Row 4 is a heuristic on a command
string, but a *narrow, anchored* one: the regex is anchored at the start of the
command, and a false positive degrades to a diff view of something that is
already diff-shaped. Row 5 needs no heuristic — `grep` is a distinct identity.

The rejected alternative was open-ended sniffing (scan any `bash` output for
diff-like or test-like structure). It fails because a false positive silently
reshapes a result the user needs to read verbatim, and because the matcher set
can never be closed or fully tested.

## Decision 2 — selection is stable across the running→done transition

`ToolCard` already resynchronizes its open state when output arrives mid-stream
(`ui/src/components/ToolCard.tsx:63-65`). If the registry re-runs on that
transition and picks a different row, the card swaps renderer under the user.

Rule: rows 2–5 match on `(toolName, args)` only, both of which are known at
`tool_start` (`shared/src/protocol.ts:361`). Rows 6–8 depend on output and are
therefore the only rows that may change when output lands, and only by replacing
the raw fallback. A specialized presentation chosen at `tool_start` is never
revoked.

**Exception, found during implementation: row 1.** Extension-rendered HTML was
assumed to be args-stable and is not — `outputHtml` is produced at `tool_end`
(`server/src/index.ts:1024`), so an extension-rendered result can only ever be
detected late. Rather than demote it, row 1 is exempt from the no-revoke rule:
`renderer.toolRenderer` is set only when an installed extension registers one
(`server/src/extensionRender.ts:99,115`), so its presence is a deliberate claim by
that extension on the tool's presentation, and it outranks our built-in guess. The
exemption is narrow — exactly one row, only ever widening authority, never
narrowing it — and is recorded in the spec rather than left as a silent
divergence.

## Decision 3 — the HTML trust boundary is named, not assumed

The previous draft's requirement ("SHALL NOT insert raw tool output as executable
HTML") read as a blanket ban and directly contradicted a ratified requirement:
`components/SharedPresentationPrimitives` → scenario `RenderExtensionHtml`
blesses `RenderedHtml`, which does `dangerouslySetInnerHTML`
(`ui/src/components/RenderedHtml.tsx:18`).

Both can be true once the two channels are distinguished:

**Trusted channel — extension-rendered HTML.** `outputHtml`, `outputHtmlCollapsed`,
and `callHtml` are produced server-side by `server/src/extensionRender.ts`, which
calls pi's ANSI-to-HTML renderer. That renderer escapes `&`, `<`, `>` at source
and emits only `<span style=…>` wrappers. Safety rests on **escaping at source**,
not on sanitization — there is no DOMPurify and no allowlist anywhere in the
repo. This is the same trust level as the server itself: an installed extension
already runs code in the server process, so an extension able to emit raw markup
is not a new privilege. Unchanged by this change.

**Untrusted channel — tool output.** `item.output` is a model- or
command-produced string. It is inert text everywhere: `<pre>` at row 7, and
markdown at row 6 through `ReactMarkdown`, which does not enable
`rehype-raw`. New presentations MUST keep it that way.

The residual risk — a third-party extension renderer that emits raw markup
instead of escaped spans — is real but pre-existing, out of scope here, and
worth its own change. This design records it rather than silently inheriting it.

## Decision 4 — actions are a closed enum over existing `useAgent` actions

The previous draft routed actions "through the application's existing command and
approval boundary". **That boundary does not exist.** There is no per-tool-call
approval anywhere in `server/src`, `ui/src`, or `shared/src`; tools run unattended
within the static sandbox config (`server/src/sandbox.ts:112,124`), changed only
by `updateConfig`. The only confirmations in the codebase are `window.confirm` for
destructive UI operations and extension-initiated dialogs.

Building an approval boundary is a separate change. The invariant this change can
enforce is stronger and cheaper: a presentation does not describe an action, it
**names one from a closed enum**, and the card maps that name to an existing
`useAgent` action.

| Action name | Maps to | Used by |
|---|---|---|
| `openFile` | `readFile(path)` (`ui/src/useAgent.ts:864`) | code search, Git diff |
| `openFileHistory` | `fetchGitFileHistory(path)` (`:896`) | Git diff |
| `openWorktreeDiff` | `fetchGitDiff(path)` (`:886`) | Git diff |
| `searchWorkspace` | `searchFiles(query)` (`:877`) | code search |
| `copy` | clipboard via `CopyButton` (existing) | all |

A presentation cannot construct a wire message, cannot call `sendMessage`, and
cannot reach `prompt`/`editPrompt` — the two actions that cause agent work. That
closes the escalation path by construction rather than by policy, which is why no
approval step is needed for the actions shipped here.

## Decision 5 — one spec domain, one dispatch path

`components/ConversationItemRendering` currently enumerates ToolCard's renderers.
Adding a `tool-result-presentations` capability without touching it leaves two
requirements describing the same component. This change modifies
`ConversationItemRendering` so `ToolCard` delegates, and the new capability owns
selection, provenance, actions, and the raw-output guarantee.

## Decision 6 — the vendor-specific summary becomes its own row

`getFormattedToolOutput` (`ui/src/util/toolOutput.ts`) does two unrelated things
under one generic name:

1. **Generic.** Reads a `__pi_render.text` envelope, and recovers a truncated JSON
   result by stripping the truncation suffix or by brace-counting. Any tool can
   emit the envelope. This is what `utilities/FormatToolOutput` specifies.
2. **Vendor-specific.** `formatParsedObject` (`:17-47`) formats a fixed field list
   — `task`, `searchMode`, `relevantFiles`, `relevantFunctions`, `nextSteps`,
   `nextStepsText`. That is the openlore `orient()` payload; the function's own
   docstring says so (`:3`), and its tests name it (`ui/src/util/toolOutput.test.ts:84,122`).

The ratified requirement `utilities/FormatToolOutput` describes only (1). The field
formatting is undocumented drift, and because it sits on the catch-all path it
fires for *any* tool whose JSON happens to carry a `title` or `summary` key — not
just openlore's.

Splitting it is the point of having a registry: a vendor-shaped renderer should be
a visible row with a named match, not a hidden branch inside a utility.

- `getFormattedToolOutput` keeps (1) and narrows to what the spec already says. Its
  loose-JSON recovery is exported so the new row can reuse it rather than
  re-implement it.
- `formatOrientSummary` moves to `ui/src/presentations/orientSummary.ts` and gets
  row 7, matching on the openlore field shape.

Rendered output is unchanged for every input. The cost is test relocation: the
field-formatting cases move from `toolOutput.test.ts` to `orientSummary.test.ts`,
and `utilities/FormatToolOutput` needs a MODIFIED delta because the function now
returns `undefined` for a JSON object with no envelope, which its current wording
does not allow.

## Open question

Whether row 7 should be dropped once openlore emits a `__pi_render` envelope of its
own, which would make it redundant. Left in place until that happens.
