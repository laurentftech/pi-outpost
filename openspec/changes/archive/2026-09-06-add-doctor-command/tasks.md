# Implementation Tasks: `pi-outpost doctor`

## Tasks

- [x] Share the configuration search with the diagnostic
  - [x] Export `implicitConfigCandidates` from `config.ts` and make `findConfigFile` use it
- [x] `server/src/doctor.ts`
  - [x] `Diagnosis` record: every input supplied rather than looked up, so checks stay pure
  - [x] `installationCheck` reusing `detectChannel` / `currentEvidence` from `update.ts`
  - [x] `configurationCheck` calling the real `findConfigFile`, never a second copy of the rule
  - [x] `settingsCheck` reporting the address as a URL, and the token as set/none only
  - [x] `addressCheck` over a `/health` probe: free, this server, or a foreign one
  - [x] `webUiCheck` over the same candidates `index.ts` tries, in its order
  - [x] `gitCheck` and `terminalCheck` as warnings — the server runs without either
  - [x] `renderReport` / `exitCodeFor`
- [x] Wire it in
  - [x] `doctor` in `parseCli`'s command list and in `--help`
  - [x] Run it in `index.ts` *before* `loadConfig`, holding the console where it is owned
  - [x] `probePty` exported from `terminalManager.ts`, so the probe is the terminal's own load
- [x] Tests
  - [x] `server/test/doctor.test.ts` — every check, both branches of each
  - [x] Real sockets for the probe: closed, `/health`, the 503 stub, a foreign service, and one that accepts and never answers
  - [x] `server/test/config-cli.test.mjs` — the real CLI in a directory with no configuration
  - [x] `server/test/cli.test.ts` — the subcommand and the flags it accepts
- [x] Documentation
  - [x] README: the command list, a `pi-outpost doctor` section, and where the global config lives on Windows
