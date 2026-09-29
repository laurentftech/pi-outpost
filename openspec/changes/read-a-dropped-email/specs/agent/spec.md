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

Naming a document of that kind again SHALL republish its extractor and reset the count. Together
with a document this system writes on the agent's behalf, that is the only way back, and neither
belongs to the agent's own choosing: an agent cannot request a tool it can no longer see, and
nothing announces the withdrawal to it.

The tools SHALL NOT be published on the strength of the workspace merely containing such a
file. A repository with a documents folder would otherwise pay for every extractor in every
session, including the ones that only ever touch code — which is the cost this requirement
exists to remove.

These definitions SHALL be registered after every other tool. Where a provider caches prompt
prefixes, publishing a tool invalidates the prefix from that tool's position onward, so the
ones that appear late in a session belong late in the list.

Where a runtime cannot change its published toolset — the RPC dialect has no command for it —
that runtime SHALL publish all of them at all times rather than emulate the gating.

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
- **WHEN** the agent's toolset is composed
- **THEN** every document extraction tool is published, as that dialect cannot change its active toolset
