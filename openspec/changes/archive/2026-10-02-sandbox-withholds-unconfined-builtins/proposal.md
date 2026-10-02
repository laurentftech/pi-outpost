## Why

A sandboxed session runs with the SDK's `noTools: "builtin"`, which starts Pi's built-in tools
inactive but leaves them registered. An inactive tool is one `setActiveTools` call away, and that
call is on the API every extension is handed. So under a sandbox without `allowBash`, an extension
could switch on Pi's unconfined `bash` (and `powershell`), and under a read-only sandbox its
unconfined `write` and `edit`. That defeats the sandbox. Driven against a real server, an
extension doing exactly that got `bash` and `powershell` active.

The RPC runtime is not affected: it refuses a sandbox outright.

## What Changes

- A sandboxed session excludes from its registry (`excludeTools`) every Pi built-in that the
  sandbox does not replace with a confined tool of the same name.
- After the session is created, a sandboxed session that still registers any Pi built-in fails to
  start. Pi does not export its list of built-ins, so pi-outpost names them; this check is what
  catches a Pi upgrade that adds one.
- An extension tool that uses an excluded name (`bash`, `powershell`, and `write`/`edit` when
  read-only) is dropped under a sandbox as well. It would be unconfined too.

## Impact

- `server/src/sandbox.ts` (`unsuppliedBuiltIns`, `assertNoUnconfinedBuiltIns`), `server/src/index.ts`.
- `architecture` spec: `SecurityModel` gains a bullet and the `UnconfinedBuiltInsAreNotRegistered` scenario.
- No user documentation impact: the README already says the sandbox replaces the built-in file
  tools and keeps bash off by default. This makes that claim true.
