# Change: cli-distribution

## Why

pi-outpost can only be run by cloning the repository: the server starts through `tsx src/index.ts`, serves the web UI from a sibling `web/dist/`, and takes its configuration from whatever `pi-outpost.config.json` happens to sit in the launch directory. There is no way to *install* it. `@pi-outpost/embed` is publishable today (v0.1.0), but the widget is useless without a server, and nobody can obtain that server except by cloning and building.

Publishing a `pi-outpost` CLI (`npx pi-outpost`) is what makes the widget's release meaningful. It also forces a question the clone-only life let us dodge: where does the configuration come from when the process no longer runs inside the repository? Today the answer is inconsistent — `PI_OUTPOST_TOKEN` overrides the config file, but `PORT` is merely a default that the file overrides, and both are read at different layers.

## What Changes

- **New `pi-outpost` CLI**, published to npm: a bundled server plus the built web UI, launched by `npx pi-outpost`. No clone, no build, no `node_modules` in the user's project.
- **Command-line flags**, mirroring the config keys that matter at launch: `--config`, `--profile`, `--cwd`, `--agent-dir`, `--port`, `--host`, `--help`, `--version`. No `--token` — an argv secret is world-readable in `ps`.
- **One precedence rule everywhere**: flag > environment variable > config file > default. **BREAKING** for `PORT`: today `server.port` in the file wins over the `PORT` env var; it will be the other way round, like `PI_OUTPOST_TOKEN` already is.
- **Config file discovery**, first found wins (no layering — the file you read is the file that runs): `--config <path>` → `PI_OUTPOST_CONFIG` → `./pi-outpost.config.json` → `~/.config/pi-outpost/config.json`.
- **User-level profiles**: `--profile work` (or `PI_OUTPOST_PROFILE`) selects `~/.config/pi-outpost/profiles/work.json`. A profile is an ordinary config file, so there is no second format to learn.
- **`pi-outpost init`**: writes a starter config, in the current directory or (with `--global`) in `~/.config/pi-outpost/`.
- **No config, no server**: the server refuses to start when it finds no config file, and points at `init`. **BREAKING** — it currently falls back to "behave like a plain local pi" (full toolset, bash enabled, agent's cwd = launch dir). That default is fine for someone who cloned the repo on purpose; it is not what should happen when a stranger types `npx pi-outpost` in their home directory. The repository ships a committed `pi-outpost.config.dev.json` that `npm run dev` passes explicitly, so the clone workflow keeps working under the same single rule.
- **Release workflow**: a GitHub Action publishes `pi-outpost` and `@pi-outpost/embed` on a `v*` tag.

## Capabilities

**New Capabilities:**
- `cli` — the `pi-outpost` binary: flags, `init`, `--help`/`--version`, exit codes, and what the published package contains.

**Modified Capabilities:**
- `config` — does not exist as a spec yet, but configuration behaviour is spec'd nowhere and is precisely what this change redefines (discovery order, precedence, profiles, refusal without a config). Introduced here as a new spec rather than a delta.

Net: two new specs (`cli`, `config`). The `api`, `agent`, `file`, `model` and `theme` specs are untouched — the wire protocol and agent behaviour do not change.

## Impact

- `server/src/config.ts` — discovery order, profiles, precedence; every `process.env` read moves behind the same rule.
- `server/src/index.ts` — `BASE_CWD`/`PORT`/`HOST` resolution, and `WEB_DIST` (`path.resolve(import.meta.dirname, "../../web/dist")`), which must keep resolving inside the published package.
- **New** `server/src/cli.ts` (argv parsing, `init`) and a bundling script reusing the esbuild setup already written for the SEA build (`server/scripts/build-sea.mjs`).
- `server/package.json` — becomes the published `pi-outpost` package (currently `@pi-outpost/server`, private): `bin`, `files`, `publishConfig`.
- `.github/workflows/` — new release workflow.
- `README.md`, `pi-outpost.config.example.json`, `docs/sea-packaging.md` (the SEA layout assumption is the same one the npm package must honour).
- Users who rely on `PORT` overriding nothing, or on starting with no config at all, are affected — both are called out as breaking above.
