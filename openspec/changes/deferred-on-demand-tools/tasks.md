## Tasks
- [ ] Register the document tools and `present_project_model` with `deferred` exposure, in both runtimes.
- [ ] Name each kind in its tool's description in a user's words.
- [ ] Declare `tool_search` where these tools are deferred and extensions are enabled; add the one-line system prompt hint.
- [ ] Enrol the on-demand tools `tool_search` loads (`details.loaded`) in the idle counts.
- [ ] RPC child: register them deferred and activate `tool_search` on `session_start`.
- [ ] Update `docs/comparison.md` (resting figure, RPC figure) and the README's description of on-demand tools.
- [ ] Tests for each scenario, including the real BM25 ranker over the real definitions; exercise the running app with an agent that finds a file on its own; strict OpenSpec validation; scenario coverage.
