## ADDED Requirements

### Requirement: Withheld tools stay withheld

A tool the server publishes on demand (a document tool, the project model tool, the extended Work
Plan tool) SHALL be published only while the rules that publish and withdraw it say so. Going back
in the conversation SHALL neither publish one nor withdraw one in use, and a tool switched on by any
other means SHALL be withdrawn before the next turn. A runtime that cannot change its toolset is
exempt.

#### Scenario: Going back in the conversation publishes nothing
- **GIVEN** a conversation of two turns that named no document
- **WHEN** the user edits the first message, and later navigates the tree back to it and sends a prompt
- **THEN** each of the two turns that follow is sent the same tools as the first turn

#### Scenario: A rewind keeps the tools in use
- **GIVEN** a conversation whose agent called the Word extractor, followed by a quiet turn
- **WHEN** the user edits the quiet turn's message
- **THEN** the turn that follows is still sent the Word extractor
- **AND** it is sent none of the extractors for the kinds no prompt named

#### Scenario: A tool switched on behind the server's back is withdrawn
- **GIVEN** a session publishing no on-demand tool
- **WHEN** an extension command switches every registered tool on, and the user then sends a prompt
- **THEN** the turn that follows is sent no on-demand tool
