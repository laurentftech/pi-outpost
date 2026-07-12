# Conversation Filter Specification

## Purpose

Lets the user declutter the conversation by hiding tool cards behind a persistent toggle,
without losing any information or activity feedback.

## Requirements

### Requirement: ToolCardToggle

The conversation SHALL offer a toggle that hides tool cards from the message list. The preference SHALL persist across reloads (localStorage). While hidden, agent activity SHALL remain observable through the existing working indicator and streaming text, and error notifications SHALL still be shown. Toggling back SHALL restore all tool cards, including those emitted while hidden.

#### Scenario: HideTools
- **GIVEN** a conversation containing tool cards
- **WHEN** the user enables the filter
- **THEN** tool cards disappear from the list; user and assistant messages are unaffected

#### Scenario: PersistedAcrossReload
- **GIVEN** the filter is enabled
- **WHEN** the page reloads
- **THEN** the filter is still enabled

#### Scenario: NothingLostOnRestore
- **GIVEN** the filter was enabled while the agent ran several tools
- **WHEN** the user disables the filter
- **THEN** every tool card from the session is visible again

#### Scenario: ActivityStillVisible
- **GIVEN** the filter is enabled
- **WHEN** the agent is running a tool
- **THEN** the working indicator still shows activity
