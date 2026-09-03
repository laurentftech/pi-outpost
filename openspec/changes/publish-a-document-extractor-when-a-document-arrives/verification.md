# Live verification

`mistral/devstral-medium-latest`, a real server, a real `.docx` in the workspace, and a
throwaway `agentDir` carrying only the API key.

```
at rest: edit, find, grep, ls, present_structure, read, work_plan, write, write_structure_figure
→ docx_extract {"path":"report.docx"}
answer: The document `report.docx` contains: …
```

- **No extractor at rest**, in a workspace that holds the document. Containing one is not
  using one.
- The prompt named `report.docx`, and the tool was **there for the first call** — no
  refusal, no repair loop, nothing discovered the hard way. That is the risk this design
  carries: a tool published a moment too late is a tool the model tried to call and could
  not.
- The other three stayed withheld.

The wire test proves the same sequence deterministically, plus the two cases a live run
cannot arrange on demand: a tool withdrawn after a turn that never called it, and one kept
after a turn that did.
