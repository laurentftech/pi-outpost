## ADDED Requirements

### Requirement: On-demand tools are deferred, not withheld

The tools the server publishes on demand (the document tools and the project model tool) SHALL be
registered with `deferred` exposure. Not declared, a tool SHALL cost the model nothing, and SHALL
remain callable from other tools and from codemode scripts, and loadable with `tool_search`.
Publishing one SHALL declare it, and withdrawing it SHALL stop declaring it without making it
unreachable.

#### Scenario: A code session declares none, and can still reach them
- **GIVEN** a session whose conversation has named no document
- **WHEN** a turn is sent
- **THEN** no document tool is declared to the model
- **AND** an extension tool calling `xlsx_extract` through `ctx.executeTool()` gets its result, not an unknown-tool error

### Requirement: The agent can load an on-demand tool by searching

Where on-demand tools are deferred, `tool_search` SHALL be declared, the system prompt SHALL say
in one line which kinds of tools it loads, and each tool SHALL be found by a search naming its kind
in a user's words. Without extensions, neither SHALL be added, and the tools SHALL be published
only by the rules that publish them on demand.

#### Scenario: Searching loads the tool for the next call
- **GIVEN** a session that has declared no document tool
- **WHEN** the agent calls `tool_search` with "read an Excel spreadsheet"
- **THEN** the next request of that turn declares `xlsx_extract`

#### Scenario: A user's words find each kind
- **WHEN** `tool_search` is asked for "Excel", "Word document", "PowerPoint", "PDF" and "Outlook email" in turn
- **THEN** each search loads, in that order, `xlsx_extract`, `docx_extract`, `pptx_extract`, `pdf_extract` and `mail_extract`

#### Scenario: The system prompt says where the tools are
- **GIVEN** a session with extensions enabled
- **WHEN** its system prompt is composed
- **THEN** it holds one line naming the kinds of tools loaded with `tool_search`, and `tool_search` is declared

#### Scenario: Without extensions nothing is added
- **GIVEN** a session with extensions turned off
- **WHEN** a turn is sent
- **THEN** `tool_search` is not declared and the system prompt holds no such line

### Requirement: A tool loaded by search is aged like the others

A document or project model tool that `tool_search` loads SHALL count as published by the server:
it SHALL be enrolled in the idle counts as it is loaded, kept while the conversation uses it, and
withdrawn by the same idle rule as a tool published on demand. A rewind SHALL keep it only if its
count is kept.

#### Scenario: A loaded tool survives the turn that loaded it
- **GIVEN** a turn in which the agent loads `xlsx_extract` with `tool_search` and then calls it
- **WHEN** the turn ends and the next prompt is sent
- **THEN** `xlsx_extract` is still declared

#### Scenario: A loaded tool nobody calls is withdrawn
- **GIVEN** a turn in which the agent loads `pdf_extract` with `tool_search` and never calls it
- **WHEN** the next turn is sent
- **THEN** `pdf_extract` is no longer declared

#### Scenario: The RPC child loads and keeps a searched tool
- **GIVEN** a workspace served by the RPC runtime
- **WHEN** the agent loads `xlsx_extract` with `tool_search`
- **THEN** the next request declares it, and it stays declared on that branch, as that dialect cannot withdraw it

## MODIFIED Requirements

### Requirement: A document extractor is published when a document arrives

The document extraction tools SHALL be published to a session only once a document of their
kind has entered the conversation. A session that has seen none SHALL publish none of them.

A document enters the conversation when the prompt being sent names a path of that kind —
which covers both a file attached through the composer, since an attached document is
written into the workspace and referenced by path, and a file the user names in their own
words. Publication SHALL happen before the turn is dispatched, so the tool is available to
the call that needs it rather than after a refusal.

A document also enters the conversation when this system writes one into the workspace on the
agent's behalf, which is what unpacking an email's attachments does. The extractor for each kind
written SHALL be published inside the turn that wrote it. This is not the guess a text match makes:
the file exists because this system just created it, and its path was never available for the user
to name — without this, an agent that has just unpacked an emailed deck holds a path it cannot open
and no way to ask for the tool.

That exception SHALL be limited to documents this system itself wrote. A path the agent merely names,
lists or finds SHALL NOT publish an extractor: the trigger is the write, not the mention.

A published extractor SHALL be withdrawn once it has gone unused for long enough, and how long
SHALL depend on whether it was ever used:

- **Never called: one turn.** The trigger is a text match and can be wrong — a path to a file
  that does not exist, a document named in passing — and a wrong guess otherwise costs every
  later request in the session.
- **Called at least once: five idle turns.** Extraction is rarely a single call, and taking a
  tool away mid-task would strand an agent that cannot ask for it back. Five turns of silence
  is the conversation having moved on.

Naming a document of that kind again SHALL republish its extractor and reset the count. The agent
SHALL also be able to bring one back on its own, by loading it with `tool_search` (see *On-demand
tools are deferred, not withheld*): a withdrawn extractor is no longer declared, but it is still
registered and can be found.

The tools SHALL NOT be published on the strength of the workspace merely containing such a
file. A repository with a documents folder would otherwise pay for every extractor in every
session, including the ones that only ever touch code — which is the cost this requirement
exists to remove.

These definitions SHALL be registered after every other tool. Where a provider caches prompt
prefixes, publishing a tool invalidates the prefix from that tool's position onward, so the
ones that appear late in a session belong late in the list.

Where a runtime cannot change its published toolset — the RPC dialect has no command for it —
that runtime SHALL register them deferred and declare none of them until the agent loads one with
`tool_search`, rather than emulate the gating.

#### Scenario: A code session publishes no extractor
- **GIVEN** a session whose conversation has named no document
- **WHEN** the agent's toolset is composed
- **THEN** none of the document extraction tools is published

#### Scenario: Naming a document publishes its extractor, before the turn
- **GIVEN** a session publishing no extractor
- **WHEN** the user sends a prompt naming a `.docx` path
- **THEN** the extractor for that kind is published before the turn is dispatched
- **AND** the extractors for the other kinds are not

#### Scenario: An attached document publishes its extractor
- **GIVEN** a document attached through the composer, written into the workspace and referenced by path
- **WHEN** the prompt is sent
- **THEN** the extractor for that kind is published

#### Scenario: Naming an email publishes the mail extractor
- **GIVEN** a session publishing no extractor
- **WHEN** the user sends a prompt naming a `.msg`, `.eml` or `.emlx` path
- **THEN** the mail extractor is published before the turn is dispatched, and the extractors for the other kinds are not

#### Scenario: An unpacked attachment publishes its extractor within the turn
- **GIVEN** a turn in which the agent unpacks an email attachment that is a `.pptx`
- **WHEN** the attachment has been written into the workspace
- **THEN** the presentation extractor is published for the rest of that turn, without the user naming the file

#### Scenario: Only the kinds actually written are published
- **GIVEN** a message whose attachments are a `.pdf` and a `.pptx`
- **WHEN** only the `.pdf` is unpacked
- **THEN** the PDF extractor is published and the presentation extractor is not

#### Scenario: A path the agent merely names publishes nothing
- **GIVEN** a turn in which the agent lists a workspace directory containing a `.xlsx`
- **WHEN** the listing returns
- **THEN** no extractor is published, because nothing was written

#### Scenario: A tool published on a wrong guess is withdrawn when the turn ends
- **GIVEN** a turn that named a document and never called the extractor published for it
- **WHEN** the turn ends
- **THEN** that extractor is withheld again
- **AND** later requests do not carry it

#### Scenario: A tool that was used survives the quiet turns around its work
- **GIVEN** an extractor that was called during the turn that published it
- **WHEN** four further turns name no document and do not call it
- **THEN** it is still published

#### Scenario: A tool nobody has wanted for five turns is forgotten
- **GIVEN** an extractor that was called earlier in the session
- **WHEN** it goes five turns without being called and without a document of its kind being named
- **THEN** it is withheld again

#### Scenario: Naming the document again brings its extractor back
- **GIVEN** an extractor withheld after going idle
- **WHEN** a prompt names a document of that kind
- **THEN** it is published again for that turn

#### Scenario: A workspace holding documents publishes nothing by itself
- **GIVEN** a workspace containing a `.pdf` that no prompt has named
- **WHEN** a session is bound to it
- **THEN** no document extraction tool is published

#### Scenario: The word is not the path
- **WHEN** a prompt discusses PDFs without naming a path of that kind
- **THEN** no extractor is published

#### Scenario: A runtime that cannot gate publishes them all
- **GIVEN** a workspace served by the RPC runtime
- **WHEN** a turn is sent that names no document and loads no tool
- **THEN** no document extraction tool is declared to the model, and `tool_search` is

### Requirement: Presentation tools are published with a template or their skill

The presentation tools — `pptx_layouts`, `pptx_create` and `pptx_render` — SHALL be published on
demand, together, by the same mechanism as the document extractors, and withdrawn by the same idle
rule.

They SHALL be published before the turn is dispatched when the prompt names a `.potx` path, names a
`.pptx` path (alongside `pptx_extract`), or invokes the skill as `/skill:pptx-from-template`. A
`.potx` SHALL NOT publish `pptx_extract`: a template is not a deck to read.

They SHALL also be published inside the turn when the agent reads the skill's `SKILL.md` — which is
how a model loads a skill on its own — or when a tool call's `path` names a `.pptx` or `.potx`.
Those agent-side triggers SHALL publish only the presentation tools: they SHALL NOT republish an
extractor. An extractor comes back when the user names a document, or when the agent loads it with
`tool_search`.

Talking about presentations without naming a file or the skill SHALL publish nothing.

In the RPC runtime, which cannot change its published toolset, the child SHALL register the three
tools with the others, deferred like them.

#### Scenario: ACodeSessionPublishesNoPresentationTool
- **GIVEN** a session whose prompts name no template and do not invoke the skill
- **WHEN** a turn is sent
- **THEN** none of the presentation tools reaches the model

#### Scenario: NamingATemplatePublishesThePresentationTools
- **WHEN** the user sends a prompt naming a `.potx` path
- **THEN** the three presentation tools reach the model on that turn, and `pptx_extract` does not

#### Scenario: LoadingTheSkillPublishesThemInTheTurn
- **WHEN** the agent reads the skill's `SKILL.md` during a turn
- **THEN** the next request of that same turn carries the three presentation tools

#### Scenario: AgentSideTriggersNeverRepublishTheExtractor
- **WHEN** a tool call's path names a `.pptx`
- **THEN** the presentation tools are published and `pptx_extract` is not

#### Scenario: TheRpcChildRegistersThePresentationTools
- **WHEN** the RPC child builds its toolset
- **THEN** it registers `pptx_layouts`, `pptx_create` and `pptx_render` after `pptx_extract`
