# Running-app verification

`npm run bench`, the widget at `http://127.0.0.1:4321/?server=http://127.0.0.1:4327`
(host page on its own origin, RPC child behind the server). The bench's thinking server
now carries two models: `local/qwen3.8-27b`, whose child reports `off, low, medium, high,
xhigh` (a real reasoning model keeps `off`, and it has no `minimal`), and
`local/plain-mini`, declared `["off"]` in server configuration — the office case, where
the child has never heard of the narrowing. The session starts on `high`.

Everything below was read back from the widget's shadow DOM, not from a screenshot.

## The walkthrough

| Step | Read back |
|---|---|
| initial state | model `local/qwen3.8-27b`, button `🧠high` |
| control opened | range `max=4`, `value=3`, end labels `off` … `xhigh` |
| switched to `local/plain-mini` with the control open | button `🧠off`, **no** range element, popover reads "this model accepts `off` only" |
| reloaded the page | the snapshot comes back `plain-mini` / `off`, control still stating the single level |
| dragged to the top stop | button `🧠xhigh`, range `value=4` |
| switched to `local/plain-mini` | button `🧠off`, no range |
| back to `local/qwen3.8-27b` | button `🧠off`, range `max=4` `value=0` — label and stop agree |

Before the change, the third row is the bug as reported: the button kept reading `high`
and the range had `max=0`, a thumb that could not be moved.

The last rows are the level *not* coming back. A detour through a model that accepts no
thinking destroys the level, and nothing restores it: on a `set_model` the child takes the
level saved for the target model, else the persisted global default, else the current one
(`agent-session.js` `_getThinkingLevelForModelSwitch`), and pi-outpost persists neither.
That was already true before this change — what changes is that the interface now says
`off` instead of still reading `xhigh`.

An earlier bench configuration gave the wide model a set without `off`, which made the
return read `low`: the child, finding nothing below, stepped *up*. That was the fake
diverging from a real model's set, not a behaviour of the product, and the bench no longer
does it.

## The destructive pass

| What was done | What happened |
|---|---|
| six model switches dispatched in one tick, ending on the narrow model | settles on `plain-mini` / `off`; no interleaved state, no level from the other model |
| seven switches ending on the wide model | settles on `qwen3.8-27b` with the range value matching the label — no state from the other model |
| dragged to the top stop, then switched model in the same tick | `xhigh` first, then `off` once the switch landed; nothing stuck mid-way |
| nine rapid toggles of the 🧠 button | popover open, still stating the single accepted level |
| the same model re-picked three times | unchanged, no flicker in the level |
| `pkill fake-pi-rpc` under the running app, then a model switch | "Agent runtime failed: the Pi RPC process ended (signal SIGTERM)" and, on the switch, "Agent runtime unavailable" — the select stays on the model that is actually current and the level is not invented |

## What the pass found that the suites did not

The fake child answered `set_model` with no data, where the real RPC dialect answers with
the model. `toModel(undefined)` then fell back to `{provider, id}`, the server read
`reasoning ?? false`, and **the whole thinking control disappeared** on a model change —
in the bench, and in any deployment whose child answers the same way. Fixed in
`rpcRuntime.setModel` by falling back to the catalog, which already knows whether a model
reasons; the fake now answers as the real one does.
