# Tasks: cli-distribution

## 1. Config: discovery, precedence, profiles

- [x] 1.1 `server/src/config.ts`: replace the two-location lookup with the ordered search (`--config` → `PI_OUTPOST_CONFIG` → `./pi-outpost.config.json` → user config dir), honouring `$XDG_CONFIG_HOME`. First found wins; an explicit path that is missing is an error.
- [x] 1.2 Profiles: `--profile <name>` / `PI_OUTPOST_PROFILE` → `<userConfigDir>/profiles/<name>.json`. Error when combined with `--config`, error when the profile file is absent.
- [x] 1.3 Apply the single precedence rule (flag > env > file > default) to port, host, cwd, agentDir and token. `PI_OUTPOST_PORT ?? PORT` inside the env layer. Remove the old `Number(process.env.PORT ?? 3141)` default-shaped read.
- [x] 1.4 Refuse to start when no config file is found: non-zero exit, the locations searched, and `pi-outpost init`.
- [x] 1.5 `loadConfig` takes the parsed CLI options as an argument (keep it a pure function of `{ cwd, flags, env }` so it stays testable).

## 2. CLI entry point

- [x] 2.1 `server/src/cli.ts`: parse argv with `node:util` `parseArgs` — `--config`, `--profile`, `--cwd`, `--agent-dir`, `--port`, `--host`, `--help`, `--version`; unknown flag → error naming it. No `--token`.
- [x] 2.2 `pi-outpost init [--global] [--force]`: write a starter config, refuse to clobber, print the path and the next command.
- [x] 2.3 `--help` prints the flags *and* the config discovery order; `--version` reads the package's own version.
- [x] 2.4 `server/src/index.ts`: take config from the CLI layer instead of reading `process.env` directly (`BASE_CWD`, `PORT`, `HOST`).

## 3. Web UI resolution

- [x] 3.1 `server/src/index.ts:239`: replace the hardcoded `../../web/dist` with: `PI_OUTPOST_WEB_DIST` if set, else the first existing of `../../web/dist` (clone + SEA) and `./web` (packaged). Fail with a clear message when none exists.
- [x] 3.2 Check `docs/sea-packaging.md` still describes a layout the new resolution accepts.

## 4. The `pi-outpost` package

- [x] 4.1 New `cli/` workspace: `package.json` (name `pi-outpost`, `bin`, `files`, `publishConfig.access: public`, license/repo/keywords), added to the root `workspaces`.
- [x] 4.2 `cli/scripts/build.mjs`: esbuild-bundle `server/src/index.ts` to `cli/dist/pi-outpost.mjs` (reuse the SEA script's options, including the `createRequire` banner), copy `web/dist` to `cli/dist/web`, add the `#!/usr/bin/env node` shebang and the executable bit.
- [x] 4.3 `prepack`: build `web`, then the bundle. Fail loudly if `cli/dist/web/index.html` is missing.
- [x] 4.4 `npm pack --dry-run`: the tarball contains the bundle, `dist/web/`, README, LICENSE — and nothing from the workspace sources.

## 5. Dev and repo workflow

- [x] 5.1 Commit `pi-outpost.config.dev.json` (agent cwd = repo, sandbox off, port 3141) and make `npm run dev` / `npm start` pass `--config` explicitly.
- [x] 5.2 Confirm the test harness (already writes a config and sets `PI_OUTPOST_CONFIG`) still passes — 21/21.

## 6. Release workflow

- [x] 6.1 `.github/workflows/release.yml`: on a `v*` tag — checkout, `npm ci`, typecheck, lint, test, build, then publish `pi-outpost` and `@pi-outpost/embed`.
- [x] 6.2 Guard: the tag version must equal the packages' `version` field, or the job fails before publishing.

## 7. Docs

- [x] 7.1 README: install/run via `npx`, the flag table, the discovery order, the precedence rule, profiles, and the two breaking changes (`PORT` precedence, refusal without a config).
- [x] 7.2 `pi-outpost.config.example.json`: left as-is on purpose. `tools` only applies in non-sandbox mode (the example uses a sandbox) and a `systemPromptFile` pointing at a file that does not exist makes the server refuse to start — adding either would break the example for anyone who copies it. Both keys are documented in the README's key table instead.
- [x] 7.3 `embed/README.md`: point at `npx pi-outpost` as the way to get a server.

## 8. Verification

- [x] 8.1 Tests for config discovery/precedence/profiles/refusal (`server/test/`), following the existing harness pattern.
- [x] 8.2 End-to-end: `npm pack` the CLI, install the tarball in a scratch directory outside the repo, `pi-outpost init`, `pi-outpost`, open the UI, send a prompt.
- [x] 8.3 `npm run typecheck`, `npm run lint`, `npm test --workspace server`.
