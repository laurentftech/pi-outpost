# Keep conversation context readable while answering questions

## Why
Extension questions currently cover the conversation with a centered modal and a backdrop.
The user cannot read, select or scroll the evidence the agent just provided while choosing.

## What Changes
- Render extension questions in the response area below the timeline, without a backdrop.
- Bound the question panel to 40% of viewport height with independent scrolling.
- Let header controls wrap on narrow screens, preserving the mobile viewport width.
- Preserve the unsent composer draft and isolate the state of successive questions.
- Retain existing answer, cancellation and timeout responses.

## Impact
Shared application layout, ExtensionDialog, integration documentation and browser regressions.
The server protocol and sandbox permission dialogs are unchanged.
