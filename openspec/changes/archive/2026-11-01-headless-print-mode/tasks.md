# Tasks

## 1. The command

- [x] 1.1 Parse `-p`/`--print`, `--json`, `--grants` and `--model`. Refuse a print flag without `-p`, `-p` beside a command, an empty prompt, a bad `--grants` value and a model that is not `provider/id`, and name them in the help. Verify with `server/test/cli.test.ts` "parseCli — print mode".
- [x] 1.2 In print mode, bind the configured server to `127.0.0.1` on a free port, with no browser and no terminal, and send every line the server writes to stderr. Once startup is complete, run the turn as the server's own client and exit with its status. Verify with `server/test/printMode.test.mjs` "APromptIsAnsweredOnStdout".

## 2. The turn

- [x] 2.1 Start a session of its own, set the model if asked, send the prompt (stdin for `-`), stream the text to stdout (or print it whole when it came without deltas), send tools and errors to stderr, and exit 0 when the turn ends and 1 when it failed or was refused. Verify with `printMode.test.mjs` "APromptFromStdin", "AFailedTurnExitsNonZero" and "a model that is not allowed …", and `server/test/printModeTurn.test.ts` "the text streamed goes to stdout, …".
- [x] 2.2 Answer a grant request by `--grants` and decline an extension's dialog, each said on stderr. Verify with `printModeTurn.test.ts` "GrantsAreRefusedUnlessAllowed" and "an extension's dialog is declined", and with the real model under MXC: refused by default, allowed with `--grants once`.
- [x] 2.3 Print every event as a JSON line with `--json`. Verify with `printMode.test.mjs` "JsonPrintsTheTurnsEvents".

## 3. Documentation and coverage

- [x] 3.1 Document `-p` and its flags in the README's command-line section. Verify that the anchor resolves.
- [x] 3.2 Write `scenario-coverage.md`, and run `npm run check:scenarios` and `openspec validate headless-print-mode --strict`; verify both pass.

## Workflow follow-up

- Archive the change after review and merge.
