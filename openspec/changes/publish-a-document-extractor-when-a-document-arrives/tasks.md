## 1. Register the extractors last

- [x] 1.1 `documentToolsLast()` in `server/src/workspace.ts` — a stable partition applied once, after the sandboxed and unconfined sets are joined, so the rule holds for both paths and the order of everything else is left alone. The unsandboxed list in `server/src/index.ts` is written in the same order.

## 2. Publish on arrival

- [x] 2.1 `documentToolsFor(text)` in `server/src/documentTools.ts`: the extractors a prompt calls for, matched on a path-like token so prose ("convert this to PDF") publishes nothing.
- [x] 2.2 Called from `handlePrompt` before `agent.prompt`, publishing through `AgentRuntime.setToolPublished` — the seam the Work Plan split added. A prompt the runtime then refuses runs no turn, so nothing would age the publication out: the rejection path withdraws exactly what that call published.
- [x] 2.3 Withheld at every bind: boot, a project started later, and a session replacement, which is a new conversation.
- [x] 2.4 Each published extractor carries a count of idle turns (`Workspace.documentToolIdleTurns`, with `documentToolsEverUsed`): a `tool_start` resets it to zero and marks the tool as wanted, `agent_end` ages the rest, and the threshold is one turn for a tool never called, five for one that was. Naming the document again republishes and resets. The wire test caught the ordering bug in the first version of this — the check read the runtime *after* publishing, so nothing was ever counted.

## 3. Proof

- [x] 3.1 `server/test/documentTools.test.ts` (7 tests): one kind publishes one tool; `@path`, quotes, Windows separators, a trailing full stop and `REPORT.PDF` all match; prose and `src/pdf.ts` do not; two kinds publish two, in registration order; the exported set and the matcher agree.
- [x] 3.2 Order: asserted at the wire, where it matters — the last tool the model is sent is the extractor.
- [x] 3.3 / 3.4 `server/test/documentToolsWire.test.mjs` — a real embedded session, asserting the tool list the **provider** was sent rather than what the snapshot claims. It walks the whole life of one tool: none of the four at rest in a workspace that *contains* a `.docx`; `docx_extract` on the very turn that names one, and not its siblings; withdrawn after a turn that never called it; called, then surviving four idle turns; forgotten on the fifth; republished when the document is named again.
- [x] 3.5 Measured: the four are 8 249 of the 23 897 characters a session's tools come to, so a session that names no document carries ~5.7k tokens against ~7.8k.

## 4. Prove the agent copes

- [x] 4.1 Done — `verification.md`. A real model, a real `.docx`: no extractor at rest in a workspace that holds the document, and `docx_extract` called on the first attempt once the prompt named it.

## 5. Review

- [x] 5.0 `codex-review --base main` over the whole stack. Four findings, all confirmed against the code and all fixed: filenames carrying parentheses or brackets matched nothing (`report (1).pdf` — the common case), a publication survived a refused prompt, the turn that called a tool was counted among its idle turns, and the named wrong-tool refusal was unreachable through the path a model actually takes. The last one was also a coverage overstatement, corrected in the spec and the matrix rather than papered over.

## 6. Validation

- [x] 6.1 Done — 10 scenarios, all covered.
- [ ] 6.2 `npm run check:scenarios`, `openspec validate --strict`, and the **full** server suite — both CI failures on this stack came from files a partial local run never touched.
