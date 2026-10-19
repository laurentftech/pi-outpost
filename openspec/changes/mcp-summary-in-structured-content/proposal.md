# show_planning's summary reaches hosts that read the structured content

## Why

`show_planning` gives the view the planning as structured content and the model a text
summary, as the MCP Apps specification advises (`structuredContent` "not added to model
context"). Claude Code does the opposite: when a tool result carries `structuredContent`,
it hands the model that object, serialized, and drops the text. A probe run with Claude
Code 2.1.303 (`scripts/probes/claude-structured-content/`) shows the text appearing
nowhere in its `stream-json` output. Under Claude Code, and so under any host that drives
it, such as Paseo, the model never learns that the planning was shown, that it does not
see the drawing, or that the file was edited into an invalid planning.

## What Changes

- `show_planning`'s structured content also carries the summary, as `summary`, the same
  text the model reads in a host that follows the specification.
- The probe that established Claude Code's behaviour is kept, runnable from any checkout.

## Impact

`mcp/src/server.ts` (`ShownPlanning`) and
`mcp/test/tools.test.ts`. The view ignores the new field. No other tool differs between its
text and its structured content: `list_plannings` sends the same object in both, and
`save_figure` is called by the view only.
