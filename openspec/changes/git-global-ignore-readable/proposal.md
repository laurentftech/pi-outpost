# A confined shell reads the global git ignore and attributes files

## Why

A confined terminal or agent shell may read the user's `~/.gitconfig` (for git's identity), but not
the files it names for every repository: `core.excludesFile` (a global `.gitignore`) and
`core.attributesFile`. Under every runner git then warns on each call — found in the running app on a
Mac whose `~/.gitconfig` names `~/.gitignore_global`: `warning: unable to access
'/Users/…/.gitignore_global': Operation not permitted`. Worse than noise: the user's global ignores
are not applied, so `git status` lists files the user means to ignore.

## What Changes

- The files `~/.gitconfig` names in `core.excludesFile` and `core.attributesFile` — absolute or `~/`,
  existing files only — become readable, read-only, beside `~/.gitconfig`, under every runner
  (landstrip, MXC on Windows, Linux and macOS, Seatbelt).
- Read from the file itself, not asked of git, which may not be on the server's search path.
- `docs/sandboxing.md`: the environment row names them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal`: git in a confined shell sees the user's global ignore file.

## Impact

`server/src/terminalSandbox.ts` (`gitReadOnlyFiles`), `server/src/confinedBash.ts`,
`server/src/index.ts`, tests, `docs/sandboxing.md`.
