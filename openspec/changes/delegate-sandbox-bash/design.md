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

### D5. The agent may not write `.pi`

pi-outpost leaves every project trusted: an extension asking gets `true`. pi-landstrip therefore
reads the project's `.pi/sandbox.json` before every command (`loadSandboxConfig` in `exec`), merged
over the global policy. Its default `toolFilesystemPolicy` is `host`, so pi-outpost's `write` could
create that file and widen the next command's policy.

The check, `piConfigWriteRefusal`, sits in the two places agent writes pass through:
- `scopeToRoot` for `write` and `edit`;
- `assertWritableDestination` for every tool that writes an output — documents, figures, tables,
  comparisons, and mail attachments file by file.

It refuses any path whose part below the writable zone has a `.pi` segment, after symlinks are
resolved. A whole-directory rule rather than a list of file names: `.pi` also holds Pi's project
settings and extensions, and a sandboxing extension may add files there that this list would not
know. Commands stay the extension's to deny; the docs give pi-landstrip's settings for it
(`denyWrite: [".pi/**"]`, `toolFilesystemPolicy: "sandbox"`).

### D6. Warn about a shadowed bash, where the user looks

`shadowedBashWarning` compares the extensions' own registrations
(`extensionRunner.getAllRegisteredTools()`) with the sandbox. A `bash` registered there while
pi-outpost supplies its own is the trap. It is reported:
- once in the log, when the session is created;
- to every browser that binds to the project, through the existing notification channel
  (`extension_ui_request` with `notify`, as a `warning`).

The session usually starts before any browser connects, so the warning is kept per project root.
The extension is named the way `bashFrom` takes it: its package source, or its path when loaded by
path.

### D7. Export the agent directory, keep the user's in the terminal

`getAgentDir()` reads `PI_CODING_AGENT_DIR` live, so exporting it once at start, before any session,
is enough. It is embedded only: the RPC child already gets it. The terminal panel is the user's
shell, so `TerminalManager` takes overrides that restore the launch value, or remove it if there was
none. A `pi` typed there keeps the user's own directory.

### D8. Skills readable by directory, decided once the session knows them

The sandboxed toolset is built before the session that loads the skills exists. So the read tools
take a getter (`skillReadRoots`) that they ask on every call. The workspace holds the list in an
object kept across rebuilds (`WorkspaceOptions.skillReadRoots`). The session factory fills it from
`resourceLoader.getSkills()`, one `baseDir` per skill, with real paths. It drops any directory that
is a filesystem root, the home directory, or an ancestor of the agent directory. The whole skill
directory is readable, because a skill's references and schemas sit beside its `SKILL.md`. Write
tools never consult the list.

## Risks / Trade-offs

- **The extension's policy decides what bash can do.** pi-outpost proves only *whose* bash runs. The
  README says so and points to the extension's policy files.
- **A path-loaded extension matches by location.** Any file under the named directory may supply
  `bash`. Name the file itself when that matters.
