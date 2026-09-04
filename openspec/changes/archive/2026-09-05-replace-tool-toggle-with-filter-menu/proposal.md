## Why

The header's `⚒ tools` button is not understood by the people using it. It names its subject rather than its action, and what it actually does — hide tool cards — lives only in a `title` attribute nobody hovers. Its state is carried by a background shade and `aria-pressed`, which reads as "selected" more than "filtering". Meanwhile the other source of conversation noise, the model's reasoning, has no filter at all: a long session of collapsed `thinking` headers cannot be turned off.

## What Changes

- Replace the single toggle with a **Filter** menu in the header: a button that opens a small popover with two checkboxes, **Tool calls** and **Reasoning**.
- **Checked means shown.** The current control is pressed when it is *hiding*; a menu of checkboxes has to read as "what the conversation contains", or every item is a double negative.
- Keep the filtering state readable while the menu is closed — the button reports that at least one kind is hidden, so the "am I looking at everything?" question is answerable without opening it.
- Add a reasoning filter that removes `thinking` blocks from assistant messages, persisted like the tool filter.
- Handle the message that a reasoning filter can empty: an assistant item whose only blocks are `thinking` blocks must not render as an empty bubble. The application already solves this shape for tool-call-only messages by rendering a bare scroll anchor; the same treatment applies here so conversation navigation never lands on nothing.
- Persist both preferences separately in `localStorage`, each tolerant of storage being unavailable, as the tool filter already is.
- Not breaking: this is a UI surface with no wire protocol, no configuration key, and no server involvement. An existing `pi-outpost:hide-tools` value keeps its meaning.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conversation-filter`: `ToolCardToggle` becomes a two-filter contract — it currently specifies a single tool toggle, and must now specify both filters, the shown-not-hidden polarity, the visible-while-closed state, independent persistence, and the empty-assistant-message case.
- `components`: `RuntimeControls` gains the `Header` filter-menu contract (a menu reporting intent through callbacks, closing on outside click and Escape, and remaining correct when the conversation changes underneath it). `ConversationItemRendering` gains `AssistantMessage`'s obligation to omit reasoning blocks when its consumer asks, and to render nothing rather than an empty container when that leaves the item with no content.

## Impact

- `ui/src/components/Header.tsx` — the `⚒ tools` button and its `onToggleHideTools` prop become a filter menu with two callbacks; reuses the existing `ui/src/util/clickOutside.ts` idiom already used by eight components.
- `ui/src/App.tsx` — `hideTools` state gains a sibling for reasoning, both persisted; the item loop at the tool-card branch is joined by a decision about assistant items left empty.
- `ui/src/components/AssistantMessage.tsx` — takes a prop to skip `thinking` blocks, and reports emptiness rather than rendering an empty frame.
- Tests: `ui/src/components/Header.test.tsx`, `ui/src/components/AssistantMessage.test.tsx`, `ui/src/App.test.tsx` (or the conversation-filter tests that cover the current toggle), plus a Playwright pass in the running widget — this is a UI surface, and the failure modes here are the menu left open while the conversation changes and the empty bubble, neither of which a unit test observes.
- No server, protocol, or configuration change.
