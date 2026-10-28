# Design

## 1. Deferred, and still published on demand
`deferred` exposure moves the cost to zero without taking the tool out of reach. Activating a
deferred tool declares it to the model, so the existing rules (publish when a prompt names a file,
when this system writes one, or when the agent touches a template; withdraw after idle turns) keep
working through the same `setActiveToolsByName`. What changes is what "withdrawn" means: the tool is
no longer declared, but it is still registered, callable from codemode and `ctx.executeTool()`, and
loadable with `tool_search`.

Publishing on a named file stays because a search costs a round trip, and because a model that sees
the tool does not have to think of looking for it.

## 2. Which tools
The document tools (`DOCUMENT_TOOLS`, `docx_compare` included where it is registered) and
`present_project_model`. `work_plan_extended` keeps its own rule: it is published while a plan
exists, and `work_plan`'s description already names it, which is the way back this change gives the
others. Moving it too is possible later. It is left out to keep this change about the tools that
have no way back today.

## 3. `tool_search` and the prompt
Pi registers `tool_search` inactive and activates it only for MCP servers with `deferred` exposure.
pi-outpost activates it wherever its own tools are deferred: in the embedded runtime with
`setToolPublished` once the session is bound, and in the RPC child from `piOutpostTools.ts` on
`session_start`. Under `noExtensions` the tool-search extension is not loaded. Nothing is added
then, and the tools are reached only by the on-demand rules, which is today's behaviour.

`tool_search`'s own description does not list what it can load, so the model has to be told. One
line in the appended system prompt names the kinds: Word, Excel, PowerPoint, PDF, email, project
model. It is short, constant, and cache-friendly.

## 4. Being found
`tool_search` ranks with BM25 over the name, the description and the schema's descriptions. Today
`xlsx_extract` describes "a spreadsheet (.xlsx)" and never says Excel; a model searching "excel"
would not find it. Each description gains its kind in a user's words. The scenario *A user's words
find each kind* runs the real ranker on the real definitions, so a description that drifts fails it.

## 5. Loaded tools join the idle counts
`tool_search` activates its matches through `setActiveTools()` and returns their names in
`details.loaded`. The `tool_result` handler enrols each on-demand name there with
`publishToolDuringTurn`. Without that, the reassertion from #381 would see a published tool it does
not track and withdraw it before the next turn: the search would work for one request and then
vanish. Enrolled, it is aged like any tool published on demand: one turn if never called, five once
used.

A rewind restores `tool_search`'s activations from the transcript. The reassertion keeps those whose
counts are kept and drops the others. The agent can search again; the counts stay the single
authority.

## 6. The RPC runtime
The child registers the tools `deferred` and activates `tool_search`. It cannot be told to publish
or withdraw anything, so nothing is published when a file is named, and a loaded tool stays
declared on its branch, which is vanilla pi's behaviour. That is still far less than today, where
every one of these tools is declared on every request.

## 7. A scenario kept under its old title
*A runtime that cannot gate publishes them all* now says the opposite of its title. OpenSpec's
archive refuses a MODIFIED requirement that drops one of its scenarios, so the title stays and its
body carries the new contract. Renaming it is a follow-up once this change is archived.

## 8. Risks
- A model that does not search will not find a tool for a file it found itself. It is no worse off
  than today, when it could not get the tool at all.
- `tool_search` is declared in sessions that never needed it: one small, constant schema, measured in
  `docs/comparison.md`.
- Loading a tool mid-session changes the declared set, which invalidates a caching provider's prefix
  from that tool onward, as publishing does today. The on-demand tools stay registered last.
