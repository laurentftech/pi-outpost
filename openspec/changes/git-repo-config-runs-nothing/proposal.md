## Why

The server runs git unconfined: `git status` on every refresh of the Files badges, `log` and `show` for the history. It ran it with the repository's own configuration, and that configuration is in the project, which the agent's confined commands can write. Git runs commands it names — `core.fsmonitor` on status, a filter's `clean`/`process` when status hashes a changed file, a diff driver's `textconv` in log and show. Shown end to end under MXC's real executor: a confined command, unable to write outside its root, wrote `core.fsmonitor` into `.git/config`, and the server's next status ran it outside the sandbox, which wrote outside the root.

## What Changes

- Every git call of the workspace Git integration runs with configuration in the environment (`GIT_CONFIG_COUNT`, the scope of `-c`, which wins over the repository's, included files too): `core.fsmonitor=false`, `core.hooksPath` to the null device, `diff.external` empty, and every filter and diff driver command the repository defines set empty — found first with `git config --name-only --get-regexp`, which runs nothing.
- `log` and `show` pass `--no-textconv` and `--no-ext-diff`.

What the server shows is git's own reading of the files: badges and history are unchanged for a repository that names no such command.

## Not in this change

The confined commands can still write `.git/config` and `.git/hooks`. What they put there no longer runs in pi-outpost, but the user's own tools — an editor's git integration, a shell prompt that shows git status, a commit hook — still read that configuration. Refusing those writes to the confined shell is a separate decision: it would also refuse the agent's own `git config` and `git remote add`.

## Capabilities

### Modified Capabilities

- `git`: adds `ARepositorysConfigurationRunsNothingInTheServer`.

## Impact

`server/src/git.ts`; `server/test/gitRepoConfigEscape.test.ts`. One `git config` read before each git call.
