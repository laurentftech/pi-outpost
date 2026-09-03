# Live verification

One run, a real model, nothing scripted. `mistral/devstral-medium-latest` through a real
server and WebSocket, in a throwaway workspace with a throwaway `agentDir` carrying only
the API key — no skills, no extensions, no session history.

The prompt asked for a plan of two tasks with a dependency, then for a passing test result
to be recorded against the second one. It did not name a tool.

```
model: mistral/devstral-medium-latest
tools published at rest: docx_extract, edit, find, grep, ls, pdf_extract, pptx_extract,
                         present_structure, read, work_plan, write, write_structure_figure,
                         xlsx_extract
→ work_plan          {"action":"create","title":"Add --json flag to CLI","tasks":[{"id":"impl",…},
                      {"id":"test",…,"dependsOn":["impl"]}]}
→ work_plan_extended {"action":"set_evidence","taskId":"test","evidence":[{"id":"focused-tests",
                      "type":"test","result":"passed","summary":"Focused tests passed"}]}
```

What this settles, and no unit test could:

- **`work_plan_extended` is absent from the resting toolset** — read from the snapshot, not
  inferred.
- **The model reached for it unprompted**, in the same turn, immediately after creating the
  plan. Nothing told it the tool existed except the common tool's description and one
  guideline line saying where evidence lives.
- **No wrong-tool attempt, no repair loop, no refusal.** The risk a split carries — a model
  hunting for an operation in the tool that does not have it — did not materialise on the
  first try.
- The dependency was expressed at creation, so narrowing the creation shape did not cost the
  thing creation is for.

The final plan carries both tasks, the dependency, and the evidence record on the second.

## Not run

The bench (`npm run bench`) was not driven for this. The change alters what the *agent* is
sent, not what the interface renders — the Work Plan panel is untouched — and the live run
above exercises exactly the surface that changed, through a running server, with the
transcript read back rather than a screenshot taken.
