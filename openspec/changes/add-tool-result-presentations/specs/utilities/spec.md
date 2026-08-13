## MODIFIED Requirements

### Requirement: FormatToolOutput

- **Implementation**: `getFormattedToolOutput::ui/src/util/toolOutput.ts`, `parseLooseJson::ui/src/util/toolOutput.ts`

The system SHALL format a tool result for display from an authoritative
`__pi_render` envelope. It SHALL recover from truncated JSON by stripping the
truncation suffix and, failing that, by brace-counting, and SHALL expose that
recovery so other presentations parse a tool result the same way rather than
re-implementing it. It SHALL return `undefined` for content that is not JSON, is
unrecoverable, or carries no envelope — never a partially parsed object presented
as complete.

Formatting that is specific to one tool vendor's payload SHALL NOT live in this
utility; it belongs to a presentation with a named match.

#### Scenario: OutputCarriesARenderEnvelope
- **GIVEN** a result containing a `__pi_render` envelope
- **WHEN** it is formatted
- **THEN** the envelope is authoritative and is used as-is

#### Scenario: OutputWasTruncatedMidObject
- **GIVEN** a JSON result cut off partway through
- **WHEN** it is formatted
- **THEN** recovery is attempted before giving up
- **AND** unrecoverable content yields `undefined` rather than a partial render

#### Scenario: OutputIsJsonWithoutAnEnvelope
- **GIVEN** a JSON result carrying no `__pi_render` envelope
- **WHEN** it is formatted
- **THEN** the result is `undefined`
- **AND** the parsed object is available to presentations through the shared recovery
