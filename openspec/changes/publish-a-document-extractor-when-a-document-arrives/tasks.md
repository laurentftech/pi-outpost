## 1. Register the extractors last

- [ ] 1.1 In `server/src/index.ts`, order the custom tools so the four extractors come after every other definition, in both the sandboxed and unsandboxed paths. A test pins the order, with the reason: what is published late should sit late.

## 2. Publish on arrival

- [ ] 2.1 A `documentToolsFor(text)` helper in the server: the extensions a prompt names, mapped to tool names. `.pdf` → `pdf_extract`, `.docx` → `docx_extract`, `.xlsx` → `xlsx_extract`, `.pptx` → `pptx_extract`, case-insensitive, matched on a path-like token rather than anywhere in prose.
- [ ] 2.2 Called on the prompt path before the turn is dispatched, publishing through `AgentRuntime.setToolPublished` — the same seam the Work Plan split added.
- [ ] 2.3 Sticky for the session: a tool once published is never withdrawn.
- [ ] 2.4 The initial active set excludes all four, unless the runtime cannot gate.

## 3. Proof

- [ ] 3.1 Unit: `documentToolsFor` — a `.docx` mention publishes one tool and not the other three; `report.pdf` and `@/srv/report.PDF` both match; the word "pdf" in prose does not; a prompt naming two kinds publishes two.
- [ ] 3.2 Unit: registration order puts the four last.
- [ ] 3.3 Wire: a real embedded session — the snapshot's tool inventory carries none of the four, then a prompt naming a `.docx` and the inventory carries `docx_extract` and still not the others.
- [ ] 3.4 Wire: the tool is published *before* the turn goes out, asserted from inside a provider that reads the tools it was actually sent — the Work Plan split proved this ordering matters and a queued publication is too late.
- [ ] 3.5 Measure: `server/scripts/probe-context-baseline.mts`, resting baseline ~7.8k → ~5.7k tokens.

## 4. Prove the agent copes

- [ ] 4.1 A live run: attach a real `.docx` through the composer and ask for its content. Read the transcript — the tool must be there for the first call, not discovered after a refusal.

## 5. Validation

- [ ] 5.1 `scenario-coverage.md` for every scenario in the delta.
- [ ] 5.2 `npm run check:scenarios`, `openspec validate --strict`, the **full** server suite — this branch's two CI failures both came from files a partial local run never touched.
