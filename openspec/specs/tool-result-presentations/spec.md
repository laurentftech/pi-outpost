# tool-result-presentations Specification

## Purpose
TBD - created by archiving change add-tool-result-presentations. Update Purpose after archive.
## Requirements
### Requirement: A single registry selects at most one presentation

The system SHALL resolve a tool call to at most one presentation through one
ordered registry. Selection SHALL be a total function: every tool call resolves,
and the last entry SHALL be a raw-output presentation that matches unconditionally.
No component outside the registry SHALL branch on tool identity or result shape to
choose a renderer.

#### Scenario: A code-search tool completes

- **WHEN** a `grep` tool call completes
- **THEN** the conversation shows the code-search presentation
- **AND** the raw input and raw output remain reachable

#### Scenario: A tool matches no specialized entry

- **WHEN** no specialized registry entry matches a tool call
- **THEN** the conversation shows the raw-output presentation
- **AND** no part of the result is discarded

#### Scenario: Two entries could match the same call

- **WHEN** a tool call satisfies the conditions of more than one registry entry
- **THEN** the entry earlier in the registry order is selected
- **AND** the selection does not depend on registration order at runtime

### Requirement: Selection is stable while a tool call streams

The system SHALL choose a presentation from the tool identity and input as soon as
they are known, and SHALL NOT replace a specialized presentation with a different
one when the output arrives. An output-dependent presentation MAY replace only the
raw-output presentation.

A rendering supplied by an installed extension is the single exception: it MAY
replace an already-chosen presentation, because the extension's claim on the
tool's presentation outranks a built-in one.

#### Scenario: Output arrives after the card is shown

- **WHEN** a tool call is rendered while running and its output arrives afterwards
- **THEN** the presentation chosen while running is still the one shown
- **AND** the card's expanded or collapsed state is not reset by the arrival

#### Scenario: A structured summary becomes available

- **WHEN** a running call shows the raw-output presentation and its completed
  output carries a recognized structured summary
- **THEN** the card may adopt the summary presentation
- **AND** the raw output remains reachable

#### Scenario: An extension rendering arrives with the output

- **WHEN** a call already showing a specialized presentation completes with a
  rendering supplied by an installed extension
- **THEN** the extension's rendering is shown instead

### Requirement: Every presentation preserves provenance

The system SHALL display the tool status and SHALL keep the original tool input
and complete original output reachable from every presentation, including
specialized ones.

#### Scenario: A user inspects a summarized Git diff

- **WHEN** the Git-diff presentation shows a per-file summary
- **THEN** the user can reveal the complete original command output
- **AND** can identify the tool call it came from

#### Scenario: A presentation cannot read its result

- **WHEN** a selected presentation receives malformed or incomplete output
- **THEN** the card falls back to the raw-output presentation
- **AND** no renderer error is surfaced in the conversation
- **AND** the error is reported to the developer console

### Requirement: Presentation actions are drawn from a closed enumeration

A presentation SHALL offer contextual actions only by naming an entry in a fixed
enumeration of workspace-navigation actions the application already provides. The
system SHALL NOT allow a presentation to construct a server message, invoke a
tool, or submit a prompt.

#### Scenario: A user opens a code-search hit

- **WHEN** the code-search presentation offers an open action for a hit and the
  user chooses it
- **THEN** the application opens that path through its existing file-preview action

#### Scenario: A presentation names an unknown action

- **WHEN** a presentation names an action outside the enumeration
- **THEN** the action is not offered
- **AND** no message is sent to the server

### Requirement: Tool output is never executable content

The system SHALL treat a tool's own output as inert. It SHALL NOT parse tool
output as HTML, insert it as markup, or execute script contained in it. This
requirement governs tool output only; HTML produced by the server-side extension
render pipeline is a separate trusted channel governed by the components
capability.

#### Scenario: A command prints HTML containing a script element

- **WHEN** a `bash` result's output contains HTML including a script element
- **THEN** the output is shown as escaped text or as a structured non-markup view
- **AND** the script does not run

#### Scenario: A tool prints markdown containing raw HTML

- **WHEN** a result rendered by a markdown presentation contains raw HTML
- **THEN** the raw HTML is shown as text rather than parsed as markup

### Requirement: Initial presentations cover search and Git diffs

The system SHALL provide a code-search presentation for `grep` results and a
Git-diff presentation for shell calls whose command is a `git diff` or `git show`
invocation, reusing the existing shared diff primitives.

#### Scenario: A Git diff is produced through the shell tool

- **WHEN** a `bash` call whose command begins with `git diff` completes
- **THEN** its output is presented with the shared diff primitives
- **AND** each changed file offers actions to open the file and its history

#### Scenario: A search returns hits across several files

- **WHEN** a `grep` call returns matches in more than one file
- **THEN** the presentation groups the matches by file
- **AND** each match offers an action to open its file

