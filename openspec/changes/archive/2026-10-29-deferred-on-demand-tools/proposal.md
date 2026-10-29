# On-demand tools are deferred, not withheld

## Why
pi-outpost saves context by withholding its document tools (Word, Excel, PowerPoint, PDF, mail)
and its project model tool until a prompt names a file of their kind, then withdrawing them after
idle turns. A withheld tool is out of reach for everything: the model, codemode scripts,
`ctx.executeTool()` and `tool_search`. The agent cannot get one back by itself. If it finds
`budget.xlsx` with `find`, it has to ask the user to name the file, or fall back on `bash`.

Pi solves the same problem differently. A tool registered with `deferred` exposure is not declared
to the model, so it costs nothing, yet it stays callable from other tools and codemode, and the
model can load it with `tool_search`. Pi's own documentation notes that such tools survive `/tree`,
a resume and a fork. Fighting the SDK's active-set handling is exactly what caused #380.

The RPC runtime gains the most. It cannot change its toolset, so today it declares every one of
these tools on every request.

## What Changes
- The document tools and the project model tool are registered `deferred`, in both runtimes.
- `tool_search` is declared wherever these tools are deferred and extensions are enabled. The
  system prompt gets one line saying which kinds of tools it loads.
- The tool descriptions name their kinds in a user's words ("Excel", "Word", "PowerPoint",
  "Outlook"), so that the search finds them.
- Publishing when a prompt names a file stays. It is the shortcut that declares the tool on the
  first turn without a search.
- A tool loaded by `tool_search` is enrolled in the idle counts, so it is aged like the others and
  the reassertion added for #380 does not withdraw it.
- In the RPC runtime, nothing is declared until the agent searches. Since that dialect cannot
  withdraw a tool, a loaded tool stays declared on its branch, as in vanilla pi.

## Impact
- `server/src/index.ts`: registration, `tool_search` activation, enrolment of loaded tools.
- `server/src/piOutpostTools.ts`: the RPC child registers the tools deferred and activates
  `tool_search`.
- The tool definitions (`docxTool.ts`, `xlsxTool.ts`, `pptxTool.ts`, `pdfTool.ts`, `mailTool.ts`,
  `presentationTools.ts`, `wordTools.ts`, `docxCompare.ts`, `projectModelTool.ts`): exposure and
  descriptions.
- `agent` spec: three added requirements, and two modified ones whose "only way back" and RPC
  clauses no longer hold.
- `docs/comparison.md`: the resting figure gains `tool_search` and loses nothing else. The RPC
  figure drops.
- Depends on #381, whose reassertion this change extends.
