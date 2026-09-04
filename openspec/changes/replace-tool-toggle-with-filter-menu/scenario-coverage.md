Enumerated with `rg '^#### Scenario:' openspec/`. All 15 delta scenarios are covered by assertions that exercise their observable contract. The scenarios inherited from `ToolCardToggle` are covered at the same boundary they were before — the conversation the user reads — now driven through the menu that replaced the toggle.

## Conversation filter delta

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `conversation-filter / HideTools` | covered | `ui/src/App.test.tsx` — “hides tool cards and leaves the messages around them alone” clears the filter through the header menu and asserts the tool card is gone from the DOM while the user text and the assistant answer remain. |
| `conversation-filter / HideReasoning` | covered | `ui/src/App.test.tsx` — “hides reasoning and keeps the answer that came with it” asserts the thinking control disappears from a message whose answer text is still rendered. |
| `conversation-filter / FiltersAreIndependent` | covered | `ui/src/App.test.tsx` — “remembers each filter across mounts, independently” asserts the reasoning entry reads unchecked and the tool entry checked after a remount; `ui/src/conversationFilters.test.ts` — “writes one kind without touching the other” asserts each write leaves the other key as it was. |
| `conversation-filter / PersistedAcrossReload` | covered | `ui/src/App.test.tsx` — “remembers each filter across mounts, independently” unmounts and remounts the app and reads the state back from the menu; `ui/src/conversationFilters.test.ts` — “keeps the meaning of a preference set before the second filter existed” asserts a pre-existing `pi-outpost:hide-tools=1` still means tools hidden. |
| `conversation-filter / StateIsVisibleWithoutOpeningTheMenu` | covered | `ui/src/components/Header.test.tsx` — “says on the closed trigger whether the conversation is filtered” asserts the trigger reads `Filter` with nothing hidden and names the count for one and two hidden kinds. |
| `conversation-filter / NothingLostOnRestore` | covered | `ui/src/App.test.tsx` — “gives every tool card back, including the ones that arrived while hidden” adds a second tool call while the filter is on and asserts both cards render once it is cleared. |
| `conversation-filter / NoEmptyMessageIsLeftBehind` | covered | `ui/src/App.test.tsx` — “leaves no empty card where a reasoning-only turn was, but keeps its place” asserts no thinking control and no reasoning text render, and that the turn's `data-item-index` anchor is still present and carries no visible card; `ui/src/components/AssistantMessage.test.tsx` — “renders nothing at all when hiding reasoning empties the message” asserts an empty container at the component boundary. |
| `conversation-filter / ActivityStillVisible` | covered | `ui/src/App.test.tsx` — “still shows that the agent is working while tool cards are hidden” asserts the working indicator with the filter cleared and a turn streaming. |

## Components delta

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `components / The filter menu reports intent rather than holding state` | covered | `ui/src/components/Header.test.tsx` — “reports the kind that was toggled rather than holding the state” asserts the callback receives `("tools", false)` and that the entry still reads checked until the parent re-renders it with new state. |
| `components / The closed trigger says whether the conversation is filtered` | covered | `ui/src/components/Header.test.tsx` — “says on the closed trigger whether the conversation is filtered”. |
| `components / The menu closes on outside click and Escape` | covered | `ui/src/components/Header.test.tsx` — “closes on an outside click without changing anything” and “closes on Escape without changing anything” each assert the menu leaves the DOM and the change callback was never invoked. |
| `components / Filter entries are checkboxes to assistive technology` | covered | `ui/src/components/Header.test.tsx` — “exposes each entry as a checkbox carrying whether that kind is shown” queries by the `menuitemcheckbox` role and asserts `aria-checked` matches the supplied filters. |
| `components / AssistantMessage omits hidden reasoning` | covered | `ui/src/components/AssistantMessage.test.tsx` — “omits reasoning when its consumer hides it, and keeps the answer”. |
| `components / A message left with nothing renders nothing` | covered | `ui/src/components/AssistantMessage.test.tsx` — “renders nothing at all when hiding reasoning empties the message” asserts the rendered container is empty. |
| `components / Hidden content is not discarded` | covered | `ui/src/components/AssistantMessage.test.tsx` — “does not discard what it hid” re-renders the same item with reasoning shown and expands the restored block. |

## Applicable main-spec scenarios

These existing contracts are directly touched by the new surface and remain covered.

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `components / AssistantContentIsRendered` | covered | `ui/src/components/AssistantMessage.test.tsx` — the markdown, image, workspace-reference and copy tests still assert the unfiltered rendering, which the reasoning filter leaves untouched by default. |
| `conversation-tree / jump to a filtered tool call` (`useConversationJump`) | covered | `ui/src/useConversationJump.test.tsx` and `ui/src/App.test.tsx` — “reveals a hidden tool call before scrolling to it” asserts the jump still un-hides tool cards now that the hook reads the filter state rather than its own flag. |
