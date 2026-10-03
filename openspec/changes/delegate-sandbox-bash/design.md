# Design

## Context

A sandboxed session is created with `noTools: "builtin"`, pi-outpost's confined tools as
`customTools`, and every Pi built-in it does not supply in `excludeTools`
(`unsuppliedBuiltIns`). `assertNoUnconfinedBuiltIns` then refuses a session that still holds a Pi
built-in. pi's `_refreshToolRegistry` builds the registry as built-ins, then extension tools, then
`customTools`, the later overriding the earlier by name. So an SDK tool wins over an extension's,
and an extension's over a built-in. `excludeTools` removes a name whoever registered it.

pi-landstrip 0.19.4 registers its own `bash` (`createBashToolDefinition` with confined operations)
and filters calls with a `tool_call` hook. Its package source in pi is `npm:pi-landstrip`. An
extension loaded by path reports `source: "cli"` and its file path.

## Goals / Non-Goals

**Goals:**
- let a named extension's `bash` be the session's `bash`;
- never run another shell silently in its place;
- keep Settings from undoing the delegation, or from saving one that cannot start.

**Non-Goals:**
- interpreting or checking the extension's own policy;
- delegating other tools (file tools are already confined by pi-outpost);
- a Settings control for `bashFrom`;
- the RPC runtime, which already refuses a sandbox;
- the terminal panel, a separate shell.

## Decisions

### D1. Name the extension, do not trust any `bash`

`bashFrom` names the one extension allowed to supply `bash`. A boolean meaning "let an extension
supply it" would hand the shell to whichever extension registers the name first, including one
installed for something else. The name matches `sourceInfo.source` (the package source pi lists),
or a path at or under the one given (`isFromExtension`). SDK and built-in sources never match.

### D2. Leave the name free, then check it

When delegated, `createSandboxedTools` builds no `bash`, and `unsuppliedBuiltIns` takes the
delegated names (`delegatedBuiltIns`) so that `bash` is not excluded. Pi's own `bash` therefore
stays in the base set, and the extension's overrides it. After the session is created,
`assertDelegatedBash` runs before `assertNoUnconfinedBuiltIns`, so a missing extension is reported
as such rather than as "Pi's unconfined bash leaked".

### D3. Server-wide, read from the configuration

`allowBash` and `bashFrom` are server-wide; a project's sandbox differs only in its roots
(`sandboxFor`). The factory reads `config.sandbox`. Calling `sandboxFor` there failed: the server's
project is still being created when its first session is.

### D4. Settings: carry over, and roll back a refused delegation

The Settings apply rebuilds `config.sandbox` from what the browser sends, and the browser does not
send `bashFrom`, so the apply carries it over. A rebuild that throws `SandboxDelegationError` is
rolled back like an extension's cancellation — runtime, workspace and file. Kept, it would make the
next start refuse. Any other rebuild error keeps its existing handling.

## Risks / Trade-offs

- **The extension's policy decides what bash can do.** pi-outpost proves only *whose* bash runs. The
  README says so and points to the extension's policy files.
- **A path-loaded extension matches by location.** Any file under the named directory may supply
  `bash`. Name the file itself when that matters.
