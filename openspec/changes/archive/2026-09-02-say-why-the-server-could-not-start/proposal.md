## Why

A server that cannot bind its port dies on an unhandled rejection. `await app.listen(...)`
is the one startup step in `server/src/index.ts` that no one catches, while every other
failure in that file — a bad flag, a failed `init`, a refused `build-exe` — goes through
`complain()` and an exit code. The operator gets a stack trace where every neighbouring
failure gets a sentence.

Opening the interface in a window of its own made this worse, and now. That change made
the double-click the intended way in on Windows, and a double-clicked process owns its
console: when it exits, the window closes and takes the message with it. The interface
never opens either, so there is no second place to look. Observed on a real Windows
machine this week — a second instance started while a first held port 3141 died silently,
and the browser window in front of the operator belonged to the *older* server, so the new
build was judged on the old one's state.

## What Changes

- Catch a failure to listen and report it the way this file reports every other startup
  failure: a line, not a stack, and a non-zero exit.
- Name the common case for what it is. A port already in use SHALL say so, name the host
  and port that were refused, and name `--port`, which is the way out.
- Hold the console open when the process owns it, so the line can be read. A shell, a
  script and CI SHALL NOT be made to wait — only the launch that has nowhere else to
  print.
- Hold it for the failures that come *before* the bind, too. A missing configuration file
  and an unparseable flag both `process.exit` on a console that a double-click owns, and
  the Windows check found the no-config window vanishing the same way the bind one did.
  One shared hold now wraps every pre-listen exit.
- No change to a server that starts: this is entirely on the path where it does not.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli`: adds a requirement covering what the binary does when it cannot start. The spec
  says today what starting does — it opens the interface, at the bound address, and a
  failure to open is not a failure to start. It says nothing about failing to start,
  which is the case this change is about.

## Impact

- `server/src/index.ts` — the unguarded `await app.listen(...)`, and the `complain()`
  path it should be joining.
- Nothing else at runtime. No configuration key, no flag, no protocol message: the
  behaviour is on a path that ends in `process.exit`.
- Tests: the server harness starts real servers on real ports, so the occupied-port case
  is reachable without a mock. Whether the console is held is a decision, and the decision
  is what gets tested — not a keypress.

## Out of scope, deliberately

- **Single-instance rendezvous**: a second launch joining the server already running
  instead of starting one. That is the better answer to the Windows case and it is a
  larger change, with a state file, a liveness probe and a key that keeps two legitimate
  projects apart.
- **Ephemeral ports**: letting the operating system choose, now that nobody types the
  address. Viable, and it costs bookmarks and embedded widgets pinned to 3141.
- **Extension failures surfaced in the interface**: `bindExtensions` never settling leaves
  the interface unconnectable and says so only on the console. Same family, different
  change.
