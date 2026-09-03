## ADDED Requirements

### Requirement: A document extractor is published when a document arrives

The document extraction tools SHALL be published to a session only once a document of their
kind has entered the conversation. A session that has seen none SHALL publish none of them.

A document enters the conversation when the prompt being sent names a path of that kind —
which covers both a file attached through the composer, since an attached document is
written into the workspace and referenced by path, and a file the user names in their own
words. Publication SHALL happen before the turn is dispatched, so the tool is available to
the call that needs it rather than after a refusal.

Publication SHALL be sticky for the rest of the session: a conversation that has handled one
document of a kind keeps that tool.

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

#### Scenario: Publication survives the rest of the session
- **GIVEN** a session that published an extractor after a document was named
- **WHEN** later prompts name no document
- **THEN** that extractor stays published

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
