# Conversation Filter Specification

## Purpose

Lets the user declutter the conversation by filtering out noisy content kinds — tool cards and
the model's reasoning — through persistent per-kind preferences, without losing any information
or activity feedback.

## Requirements

### Requirement: ConversationContentFilters

The conversation SHALL offer filters that remove noisy content kinds from the message list: tool cards, and the model's reasoning. Each filter SHALL be presented as a checked-when-shown control, so that a checked box means the conversation contains that kind and clearing it removes that kind. The control that opens them SHALL state that it filters — not the name of one kind it acts on — and SHALL remain readable as "something is hidden" while it is closed, so the user can tell whether they are looking at the whole conversation without opening it.

Each filter's preference SHALL persist across reloads independently of the other (localStorage), and SHALL survive storage being unavailable by falling back to showing that kind for the session.

While any filter hides content, agent activity SHALL remain observable through the existing working indicator and streaming text, and error notifications SHALL still be shown. Clearing a filter SHALL restore all content of that kind, including content emitted while it was hidden — nothing is dropped from the session, only from the rendering.

Filtering SHALL NOT leave an empty frame where a message was. An assistant message whose only content is reasoning SHALL, while reasoning is hidden, occupy no visible card while remaining a navigable position in the conversation, so a jump to that turn does not land on nothing.

#### Scenario: HideTools
- **GIVEN** a conversation containing tool cards
- **WHEN** the user clears the tool-calls filter
- **THEN** tool cards disappear from the list; user and assistant messages are unaffected

#### Scenario: HideReasoning
- **GIVEN** a conversation whose assistant messages carry reasoning alongside their answers
- **WHEN** the user clears the reasoning filter
- **THEN** the reasoning disappears from those messages and their answer text remains

#### Scenario: FiltersAreIndependent
- **GIVEN** the reasoning filter is cleared and the tool-calls filter is not
- **WHEN** the conversation renders
- **THEN** tool cards are present and reasoning is absent

#### Scenario: PersistedAcrossReload
- **GIVEN** either filter is cleared
- **WHEN** the page reloads
- **THEN** that filter is still cleared and the other is in the state it was left in

#### Scenario: StateIsVisibleWithoutOpeningTheMenu
- **GIVEN** at least one kind is hidden
- **WHEN** the user looks at the closed filter control
- **THEN** it reports that the conversation is filtered

#### Scenario: NothingLostOnRestore
- **GIVEN** the tool-calls filter was cleared while the agent ran several tools
- **WHEN** the user checks it again
- **THEN** every tool card from the session is visible again

#### Scenario: NoEmptyMessageIsLeftBehind
- **GIVEN** an assistant message whose only blocks are reasoning
- **WHEN** reasoning is hidden
- **THEN** no empty message card is rendered for it
- **AND** navigating to that turn still lands at its position in the conversation

#### Scenario: ActivityStillVisible
- **GIVEN** the tool-calls filter is cleared
- **WHEN** the agent is running a tool
- **THEN** the working indicator still shows activity

