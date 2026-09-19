## ADDED Requirements

### Requirement: ACodeBlockCanBeCopied

Every code block shown as code in an assistant reply SHALL carry a copy control in its top-right corner that copies the block's content exactly, without its fence or language tag, and SHALL confirm the copy.

#### Scenario: CopyingACodeBlock
- **GIVEN** a reply containing a ```` ```ts ```` block
- **WHEN** the reader activates the block's copy control
- **THEN** the clipboard holds the block's content without the fence, and the control shows that it copied
