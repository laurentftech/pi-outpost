## ADDED Requirements

### Requirement: ContextPreservingExtensionQuestions
Extension questions SHALL appear below the conversation, keeping its text readable,
scrollable and interactive. Panels SHALL scroll independently within 40% of viewport height.
The application SHALL preserve composer drafts and isolate each request's initial state.
Existing answer, refusal and timeout responses SHALL remain available.

#### Scenario: ReadConversationWhileAnswering
- **GIVEN** an extension question and a conversation containing earlier evidence
- **WHEN** the user scrolls, clicks and selects that evidence before answering
- **THEN** the question remains pending and the evidence is unobscured and interactive
- **AND** answering by keyboard sends the selected value and removes the question

#### Scenario: LongQuestionsLeaveMobileContextReadable
- **GIVEN** a small viewport and a question containing a long list of options
- **WHEN** the user reads the conversation, resizes the viewport and scrolls the options
- **THEN** the question stays below the timeline and uses at most 40% of viewport height
- **AND** conversation scrolling remains usable and the last option can be selected

#### Scenario: SuccessiveQuestionsPreserveDraftAndIsolateAnswers
- **GIVEN** an unsent composer draft and successive input, editor, checkbox and confirmation requests
- **WHEN** the user answers each request and explicitly refuses the final confirmation
- **THEN** each request starts with its own empty or supplied initial state
- **AND** the extension receives the individual answers and refusal
- **AND** the original composer draft is restored unchanged
