## ADDED Requirements

### Requirement: ConversationFilterControls

`Header` SHALL expose the conversation's content filters as a single labelled menu rather than one button per kind. The menu SHALL render only the filter state supplied to it and SHALL report each requested change through a callback, holding no filtering state of its own. Its trigger SHALL carry the filtered/unfiltered state so it is legible while the menu is closed, and the menu SHALL be dismissible the way the application's other popovers are — a click outside it and the Escape key — so it cannot be stranded open over a conversation that has moved on.

Each entry SHALL be an accessible checkbox-like control reporting its checked state to assistive technology, where checked means the kind is shown.

`AssistantMessage` SHALL omit reasoning blocks when its consumer asks for them to be hidden, and SHALL render no visible container at all when that leaves the message with nothing to show, rather than an empty frame. Filtering SHALL be a rendering decision only: the component SHALL NOT discard the blocks it was given, so the same item renders in full once the filter is cleared.

#### Scenario: The filter menu reports intent rather than holding state
- **GIVEN** `Header` is supplied with filter state and a change callback
- **WHEN** the user toggles a kind in the menu
- **THEN** the requested kind and its new value are reported through the callback
- **AND** the header renders the state it was supplied rather than a state of its own

#### Scenario: The closed trigger says whether the conversation is filtered
- **GIVEN** `Header` is supplied with at least one kind hidden
- **WHEN** the menu is closed
- **THEN** the trigger presents the conversation as filtered

#### Scenario: The menu closes on outside click and Escape
- **GIVEN** the filter menu is open
- **WHEN** the user clicks outside it, or presses Escape
- **THEN** the menu closes and no filter change is reported

#### Scenario: Filter entries are checkboxes to assistive technology
- **GIVEN** the filter menu is open
- **WHEN** it is inspected through the accessibility tree
- **THEN** each entry exposes a checked state that matches whether that kind is shown

#### Scenario: AssistantMessage omits hidden reasoning
- **GIVEN** an assistant item carrying reasoning and answer blocks
- **WHEN** `AssistantMessage` renders it with reasoning hidden
- **THEN** the answer is rendered and no reasoning block is present

#### Scenario: A message left with nothing renders nothing
- **GIVEN** an assistant item whose only blocks are reasoning
- **WHEN** `AssistantMessage` renders it with reasoning hidden
- **THEN** it renders no visible message container

#### Scenario: Hidden content is not discarded
- **GIVEN** an assistant item rendered with reasoning hidden
- **WHEN** the same item is rendered again with reasoning shown
- **THEN** its reasoning is present in full
