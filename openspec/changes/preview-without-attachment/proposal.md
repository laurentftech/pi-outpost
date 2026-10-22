## Why
Opening files often attaches unintended context to the next prompt. The user requests preview-only behavior by default.

## What Changes
- Opening, rendering or refreshing a file never modifies prompt attachments.
- Explicit tree references, @ mentions and imports continue to work.
- Remove obsolete automatic-preview attachment state in App.

## Capabilities
### Modified Capabilities
- preview-file-attachments: replace automatic preview attachment with explicit user choice.

## Impact
App attachment effect, tests, specs and user documentation.
