## 1. Filter state in the application

- [x] 1.1 Replace `hideTools` in `ui/src/App.tsx` with a single filter object in shown-semantics (`{ tools, reasoning }`), each seeded from its own `localStorage` key (`pi-outpost:hide-tools` unchanged, `pi-outpost:hide-reasoning` new) inside the existing `try/catch`, and one change handler that persists in the stored hiding polarity; verify with tests asserting a pre-existing `pi-outpost:hide-tools=1` value still yields tool cards hidden on first render, that a throwing storage falls back to showing both kinds, and that toggling each kind writes only its own key — covers PersistedAcrossReload and FiltersAreIndependent.
- [x] 1.2 Apply the reasoning filter where the item list is rendered: an assistant item whose blocks are all `thinking`, while reasoning is hidden, takes the existing bare-anchor path used for tool-call-only messages instead of rendering `AssistantMessage`; verify with a test asserting no message card is rendered for such an item and that its scroll anchor is still present — covers NoEmptyMessageIsLeftBehind.
- [x] 1.3 Verify the decision is made per render rather than latched: a test that renders an assistant item holding only a `thinking` block with reasoning hidden, then re-renders it after a text block arrives, asserts the message appears — the streaming case named in design.md.

## 2. Header filter menu

- [x] 2.1 Replace the `⚒ tools` button in `ui/src/components/Header.tsx` with a labelled `Filter` trigger opening a popover of checkbox entries (Tool calls, Reasoning), rendering only supplied state and reporting each change through one callback; verify with component tests asserting the callback receives the toggled kind and its new value, and that the component holds no filter state of its own — covers The filter menu reports intent rather than holding state.
- [x] 2.2 Make the closed trigger report that the conversation is filtered whenever at least one kind is hidden; verify with a component test asserting the filtered presentation with one kind hidden and its absence with both shown — covers The closed trigger says whether the conversation is filtered.
- [x] 2.3 Dismiss the menu through the existing `ui/src/util/clickOutside.ts` idiom and on Escape, reporting no filter change on either; verify with component tests for both dismissals asserting the change callback was not invoked — covers The menu closes on outside click and Escape.
- [x] 2.4 Expose each entry with a checked state in the accessibility tree, checked meaning shown; verify with a test querying by checkbox role and asserting the checked state matches the supplied filter — covers Filter entries are checkboxes to assistive technology.

## 3. Assistant message rendering

- [x] 3.1 Add the reasoning-hidden prop to `ui/src/components/AssistantMessage.tsx` so `thinking` blocks are skipped while every other block renders unchanged; verify with tests asserting the answer text is present and no thinking control is, and that re-rendering the same item with reasoning shown restores it in full — covers AssistantMessage omits hidden reasoning and Hidden content is not discarded.
- [x] 3.2 Render no visible container when hiding reasoning leaves the message with nothing; verify with a test asserting the component produces no message frame for a reasoning-only item — covers A message left with nothing renders nothing.

## 4. Existing behaviour preserved

- [x] 4.1 Rewrite the tests that drive the old `⚒ tools` button against the new menu, keeping their contracts: hiding tool cards leaves user and assistant messages untouched, restoring shows every card emitted while hidden, and the working indicator still reports activity while tools are hidden — covers HideTools, NothingLostOnRestore and ActivityStillVisible.
- [x] 4.2 Add the reasoning equivalent: reasoning hidden removes it from messages that also carry answers, leaving their text intact — covers HideReasoning.
- [x] 4.3 Run `npm run lint`, `npm run typecheck`, the `ui` suite, and `npm run check:scenarios` with the scenario-coverage matrix written to `openspec/changes/replace-tool-toggle-with-filter-menu/scenario-coverage.md`.

## 5. Exercise it in the running app

- [x] 5.1 Rebuild `web`, then `@pi-outpost/embed`, then `build:e2e-host`, and drive the feature in the bench (`npm run bench`, host 4321 on 127.0.0.1): open the menu, clear each kind, read the DOM back to confirm what disappeared and that the trigger reports the filtered state, then reload and confirm both preferences survived.
- [x] 5.2 Monkey-test the transitions rather than the walkthrough: spam the trigger and the entries, leave the menu open while a turn streams and while the session or project is switched underneath it, clear reasoning mid-stream on a turn that has produced only reasoning so far, and jump to a filtered-away turn from the conversation navigation. Read back the DOM after each burst and report what broke, not that it works.
