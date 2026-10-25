# A confined terminal keeps its shell history out of the project

## Why

A confined terminal's `HOME` is its sandbox root — the user's project. An interactive
shell writes its history into `HOME` as it exits, so every closed terminal on Linux or
macOS left a `.bash_history` or `.zsh_history` in the project, untracked in git. Windows
already sends the profile's data to the terminal's private temp for that reason.

Found through a flaky CI job: `mxc-linux` failed with `ENOTEMPTY` because bash wrote
`.bash_history` into the root about 50 ms after the test closed the terminal and started
deleting it.

## What Changes

- The confined environment on Linux and macOS sets `HISTFILE` to a file in the private
  temp, and `ZDOTDIR` to that temp: macOS's `/etc/zshrc` sets `HISTFILE` to
  `${ZDOTDIR:-$HOME}/.zsh_history` over ours. With it, zsh no longer reads startup files a
  project may carry in its root.
- History no longer carries from one confined terminal to the next, as on Windows.
- The confined-terminal tests on POSIX delete their root with retries, for the shell's
  grace to exit.

## Impact

`server/src/terminalSandbox.ts` (`confinedEnvironment`, used by the confined terminal and
by the agent's confined bash, where a non-interactive shell writes no history); tests.
