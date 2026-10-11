# Tasks

## 1. The rule

- [x] 1.1 `server/src/commandPolicy.ts`: globs, offered commands, refused prompts.
- [x] 1.2 `server/src/config.ts`: `blockedCommands`, `allowedCommands`, checked at startup.
- [x] 1.3 `server/src/index.ts`: the list filtered where it is sent; `prompt` and `edit_prompt` refused first.

## 2. Checks and docs

- [x] 2.1 `server/test/commandPolicy.test.ts`, `server/test/commandPolicyWire.test.mjs` (a real extension, no model).
- [x] 2.2 README configuration keys, how-to, example configuration; `scenario-coverage.md`, `check:scenarios`, `openspec validate --strict`.
