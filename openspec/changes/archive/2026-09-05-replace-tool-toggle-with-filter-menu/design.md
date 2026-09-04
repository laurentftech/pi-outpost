## Context

See proposal.md — Why.

Two mechanisms sit behind what looks like one feature, and they are not the same shape. A tool call is a whole `ChatItem` (`kind: "tool"`), filtered out with a single early return in the application's item loop (`ui/src/App.tsx`, the `item.kind === "tool"` branch). Reasoning is not an item: it is a block inside an assistant item (`block.type === "thinking"`), rendered by `ThinkingBlock` inside `ui/src/components/AssistantMessage.tsx`. So one filter acts on the list and the other acts inside a renderer, and only the second one can leave a message with nothing in it.

The header's current control is a `<button aria-pressed>` in `ui/src/components/Header.tsx` with an `onToggleHideTools` callback, and the state it renders lives in `App.tsx` as `hideTools`, seeded from `localStorage` in a `try/catch` because storage can throw. The application already has a popover idiom: `ui/src/util/clickOutside.ts`, used by eight components.

`App.tsx` already meets the "an item that renders to nothing is still a position" problem for tool-call-only assistant messages, and solves it by emitting a bare scroll anchor. That existing solution is the one to extend, not a new one.

## Goals / Non-Goals

**Goals:**

- One control that names the act (filtering) and reports what is currently filtered without being opened.
- Filtering that is purely a rendering decision, reversible with no data loss, on both kinds.
- The reasoning filter never producing a blank card or a dead scroll target.

**Non-Goals:**

- Filtering any other content kind (user messages, custom extension messages, errors). The menu is built to take a third entry later; this change ships two.
- A server-side or per-session preference. These stay per-browser, like the current toggle.
- Changing how `ThinkingBlock` renders when it *is* shown — it stays collapsed-by-default.
- Migrating the existing `pi-outpost:hide-tools` key. It keeps its name and meaning.

## Decisions

### Checked means shown, and the stored keys stay hide-shaped

The menu presents *what the conversation contains*: `Tool calls ✓`, `Reasoning ✓`. Clearing a box removes that kind. A menu whose boxes mean "hide this" forces the reader through a double negative on every glance, and the current button's `aria-pressed`-means-hiding is precisely the confusion being fixed.

The persisted keys stay in the hiding polarity — `pi-outpost:hide-tools` keeps its exact name and semantics, and reasoning joins it as `pi-outpost:hide-reasoning`. Inverting the stored value would silently flip the preference of every existing user on first load, which is a worse outcome than a small mismatch between the UI's polarity and the storage key's name. The inversion happens once, where the state is read.

Alternative considered: a tri-state segmented control ("All / No tools / Reading view"). It reads faster but cannot express the four combinations two independent filters give, and it makes a third kind a redesign rather than a fourth entry.

### The filter state is one object passed down, not two booleans threaded

`App.tsx` holds `{ tools: boolean; reasoning: boolean }` (shown-semantics) and passes it, plus one `onFilterChange(kind, shown)` callback, to `Header`. Two independent boolean props and two callbacks would work today and would need editing at every layer for a third kind. `Header` stays stateless about filtering — it holds only whether its own popover is open.

### The reasoning filter is applied inside AssistantMessage, and emptiness is reported upward

`AssistantMessage` receives `hideReasoning` and skips those blocks. It must not be the one to decide "this turn does not exist" — that is the list's job, because the list owns the scroll anchor. So the emptiness decision is made where the item is rendered: an assistant item whose blocks are all `thinking`, with reasoning hidden, takes the same bare-anchor path `App.tsx` already uses for tool-call-only messages, and `AssistantMessage` is not rendered at all for it.

Alternative considered: letting `AssistantMessage` return `null`. That keeps the check in one place but puts a hole in the list where the anchor should be — the exact defect the existing bare-anchor path was written to avoid.

Streaming is the case that makes this ordering matter: an assistant item that currently holds only a `thinking` block may grow a text block a second later. The decision is therefore made per render from the blocks present, never latched.

### The menu reuses clickOutside, and closes on Escape

Not a new popover mechanism. Escape is added because a filter menu is opened by keyboard as easily as by mouse, and because a menu stranded open over a conversation that has since changed is the failure this project has already hit once with the per-repository git menu.

## Risks / Trade-offs

- **One click becomes two for the most common action.** → The trigger keeps a visible filtered state, so the round trip is only needed to *change* the filter, not to check it. If this proves annoying in the running app, a middle-click or a modifier shortcut can restore one-click "hide tools" later without changing the contract.
- **The stored key's name no longer matches the UI's polarity.** → Confined to the two `localStorage` reads, each of which inverts once, and documented where it happens. The alternative silently flips existing users' preference.
- **A streaming assistant message can flicker between "nothing" and "a card"** as its first text block arrives while reasoning is hidden. → Per-render decision from the blocks present makes this correct rather than latched; the bench pass has to watch a live turn with reasoning hidden, not just a seeded transcript.
- **Tests that drive the old `⚒ tools` button break.** → Intended: they encode the label being replaced. They are rewritten against the menu, not adapted with a selector change.

## Migration Plan

None needed at runtime. The stored `pi-outpost:hide-tools` value carries over unchanged, and a browser with no `pi-outpost:hide-reasoning` key shows reasoning, which is today's behaviour.
