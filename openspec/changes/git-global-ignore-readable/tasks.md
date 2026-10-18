## 1. Implementation

- [x] 1.1 `gitReadOnlyFiles`: `~/.gitconfig` plus the existing files its `[core]` `excludesFile` and `attributesFile` name (quoted, `~/`, comments); read from the file.
- [x] 1.2 The agent's `bash` and the terminal give every runner those files read-only.
- [x] 1.3 `docs/sandboxing.md`: the environment row.

## 2. Tests

- [x] 2.1 Unit: parsing (section, case, quotes, `~/`, comments, missing file, other sections ignored), and the files in the policies read-only, their folder not.
- [x] 2.2 Real: under Bubblewrap (Docker, `mxc-linux`) and Seatbelt through MXC (`mxc-macos`), `git status` in a repository with an ignored file — quiet, file not listed, the rest of the home unreachable.
- [x] 2.3 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, typecheck, lint.

## After merge

- Archive the change from `main`.
