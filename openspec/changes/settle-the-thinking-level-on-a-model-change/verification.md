# Running-app verification

`npm run bench`, the widget at `http://127.0.0.1:4321/?server=http://127.0.0.1:4327`
(host page on its own origin, RPC child behind the server). The bench's thinking server
now carries two models: `local/qwen3.8-27b`, whose child reports `low, medium, high,
xhigh`, and `local/plain-mini`, declared `["off"]` in server configuration — the office
case, where the child has never heard of the narrowing. The session starts on `high`.

Everything below was read back from the widget's shadow DOM, not from a screenshot.

## The walkthrough

| Step | Read back |
|---|---|
| initial state | model `local/qwen3.8-27b`, button `🧠high` |
| control opened | range `max=4`, `value=3`, end labels `off` … `xhigh` |
| switched to `local/plain-mini` with the control open | button `🧠off`, **no** range element, popover reads "this model accepts `off` only" |
| reloaded the page | the snapshot comes back `plain-mini` / `off`, control still stating the single level |
| back to `local/qwen3.8-27b` | button `🧠low`, range `max=4` `value=1` — label and stop agree |

Before the change, the third row is the bug as reported: the button kept reading `high`
and the range had `max=0`, a thumb that could not be moved.

The last row is the child's own clamp made visible. Its accepted set does not include
`off`, so on the way back it moves `off` to `low` and says nothing; the runtime now
re-reads the state, and the interface shows `low` instead of claiming `off`.

## The destructive pass

| What was done | What happened |
|---|---|
| six model switches dispatched in one tick, ending on the narrow model | settles on `plain-mini` / `off`; no interleaved state, no level from the other model |
| seven switches ending on the wide model | settles on `qwen3.8-27b` / `low`, range `value=1` — consistent with the label |
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
