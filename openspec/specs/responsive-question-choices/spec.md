# Responsive Question Choices Specification

## Purpose

Keeps extension and sandbox questions readable as the available panel width changes, while
preserving conversation access and requiring an explicit decision to resolve a request.

## Requirements

### Requirement: ResponsiveQuestionChoices

Question choice buttons and checkboxes SHALL use at most two columns, based on the panel's
available width. Two columns SHALL provide roughly 320 px per choice and preserve reading order.
Long descriptions and narrow panels SHALL keep one column. Resizing SHALL preserve selected values.

#### Scenario: ShortChoicesFollowAvailablePanelWidth
- **GIVEN** brief choices in a wide question panel
- **WHEN** the panel is narrowed by a sidebar or viewport resize and then widened
- **THEN** choices switch between two columns and one without changing their order or answers
- **AND** two-column choices each have at least 320 px of width

#### Scenario: LongChoiceDescriptionsStayStacked
- **GIVEN** a wide screen and choices containing a long description
- **WHEN** single-choice buttons or multi-choice checkboxes render
- **THEN** the choices remain in one column and can be answered with their original values

### Requirement: ReadableLongSandboxRequests

Sandbox requests SHALL appear below the conversation in a panel at most 40% of viewport height.
The conversation SHALL stay interactive. Details SHALL scroll independently while decision controls remain visible.
The command, targets, access modes and explanation SHALL remain complete. Reading and resizing SHALL
not approve anything; only an explicit decision SHALL resolve the request through the server.

#### Scenario: LongSandboxRequestsKeepContextAndDecisionsVisible
- **GIVEN** a sandbox request with a long command, many long paths and a long explanation
- **WHEN** the user reads the conversation, resizes to mobile and scrolls the permission details
- **THEN** the timeline stays unobscured and all details remain available without horizontal overflow
- **AND** refuse, allow once and allow for this session remain visible
- **AND** the command runs only after explicit approval and never after refusal
