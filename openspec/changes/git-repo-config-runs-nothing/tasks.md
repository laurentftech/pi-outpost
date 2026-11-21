# Tasks

- [x] 1. Reproduce: `server/test/gitRepoConfigEscape.test.ts` — six vectors, and the whole path under MXC's real executor (fails without the fix: 6 of 8).
- [x] 2. Override the repository's command-naming configuration in the environment of every git call; `--no-textconv --no-ext-diff` on log and show (`server/src/git.ts`).
- [x] 3. The git suites stay green.
