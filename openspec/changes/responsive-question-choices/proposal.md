# Fit question choices and long permission requests to their available space

## Why
A single column wastes vertical space for brief choices on wide screens. Long descriptions
need the full width. Sandbox permission requests use a separate, unbounded modal and can
obscure both the conversation and the decision buttons when the content is long.

## What Changes
- Use at most two columns for brief choices when the question panel offers roughly 320 px per choice.
- Keep a single column for narrow panels, single choices and long descriptions.
- Apply the same layout to choice buttons and checkboxes, preserving order and selection on resize.
- Put sandbox requests below the conversation with bounded, independently scrolling details.
- Keep all three permission decisions visible and retain explicit approval and server resolution.

## Impact
ExtensionDialog, SandboxGrantDialog, App pending-question layout, integration and sandbox docs.
Grant validation, scope, expiry and execution semantics remain unchanged.
