## Context

pi-outpost runs from a clone: `tsx server/src/index.ts`, web UI served from `../../web/dist`, config picked up from `PI_OUTPOST_CONFIG` or `./pi-outpost.config.json`, everything else defaulted. Publishing a `pi-outpost` CLI moves the process out of the repository, and three assumptions break at once: the entry point is no longer a TypeScript file, `../../web/dist` is no longer a sibling directory, and "the launch directory" is no longer a place the user prepared.

The pieces that already exist and are reused rather than rebuilt:

- `server/scripts/build-sea.mjs` already bundles the whole server into one ESM file with esbuild (`platform: node`, `format: esm`, a `createRequire` banner for CJS deps that `require()` builtins). The npm bundle is the same esbuild call with a different output path.
- `server/test/harness.mjs:61` already starts the server with an explicit `PI_OUTPOST_CONFIG` — the "refuse without a config" rule below costs the test suite nothing.
- `loadConfig(baseCwd)` (`server/src/config.ts:159`) already validates every key and resolves relative paths against the config file's directory. This change reorders *where the values come from*; the validation stays as is.

## Goals / Non-Goals

**Goals:**
- `npx pi-outpost` works with no clone, no build step, no `node_modules` in the user's project.
- One precedence rule, stated once, true everywhere.
- A stranger typing `npx pi-outpost` in their home directory does not get an agent with bash and write access to it.
- A user who runs pi-outpost from several places (work, home) configures each once, not per directory.

**Non-Goals:**
- Publishing `@pi-outpost/shared` or the server as a library. The CLI is an application; its only public surface is the command line.
- Replacing the SEA/Windows `.exe` path (`docs/sea-packaging.md`). It stays, and keeps its own layout assumption.
- A config *schema* file (JSON Schema, `$schema` autocompletion). Worth doing, not now.
- Layered/merged configuration. See below — explicitly rejected.

## Decisions

### The published package is a new `cli/` workspace, not `server/`

npm cannot pack a file outside the package directory, so publishing `server/` could never include `web/dist` — the web UI would be missing from the tarball. A `cli/` workspace builds a self-contained tree instead:

```
cli/dist/pi-outpost.mjs   the esbuild bundle of server/src/index.ts (+ its deps)
cli/dist/web/             a copy of web/dist
cli/package.json          name: "pi-outpost", bin: { "pi-outpost": "dist/pi-outpost.mjs" }
```

`server/` stays private and stays the place the code lives; `cli/` is packaging only (a build script and a manifest).

*Consequence:* `WEB_DIST` (`server/src/index.ts:239`) can no longer be a single hardcoded `../../web/dist`. It becomes: `PI_OUTPOST_WEB_DIST` if set, else the first of `../../web/dist` (clone, and the SEA layout) and `./web` (packaged, sibling of the bundle) that exists. Three layouts, one resolution, and the SEA build keeps working untouched.

### Precedence: flag > env > config file > default

Today the rule is not a rule: `PI_OUTPOST_TOKEN` overrides the file, while `PORT` is only consulted as the *default* that `server.port` then overrides (`config.ts:168`). Same file, opposite directions. Unifying on **env beats file** is the direction that makes the token's behaviour ordinary instead of exceptional, and it is what every deployment tool assumes (a container that sets `PI_OUTPOST_PORT` expects to be obeyed, not silently ignored by a baked-in file).

**BREAKING**: a deployment that sets `PORT` *and* ships `server.port` changes behaviour. Called out in the proposal and in the README.

Env names are `PI_OUTPOST_*` (`PI_OUTPOST_PORT`, `PI_OUTPOST_HOST`, `PI_OUTPOST_CWD`, `PI_OUTPOST_AGENT_DIR`, `PI_OUTPOST_TOKEN`, `PI_OUTPOST_CONFIG`, `PI_OUTPOST_PROFILE`). Bare `PORT` is still read, but only as a fallback *within the env layer* (`PI_OUTPOST_PORT ?? PORT`), because PaaS hosts inject it and it costs one `??` to be a good citizen.

`--token` is deliberately absent: argv is world-readable through `ps`. The token comes from `PI_OUTPOST_TOKEN` or the file, as it does today.

### Config discovery: first found wins, no merging

In order: `--config <path>` → `PI_OUTPOST_CONFIG` → `./pi-outpost.config.json` → `~/.config/pi-outpost/config.json` (`$XDG_CONFIG_HOME` honoured). An explicit path that does not exist is an error; the two implicit locations are simply skipped.

Exactly one file is read. Layering a project file over a user file would be convenient (the token, written once) but it makes the running configuration something you cannot see: a `sandbox.allowBash: true` inherited from `~/.config` would not appear anywhere in the file the user is looking at. For a tool whose config decides whether an agent can run bash on your machine, "what you read is what runs" beats convenience. The token already has an escape hatch that doesn't need layering — the env variable.

The server logs which file it loaded (it already does: `config.ts:286`).

### Profiles are ordinary config files, one per file

`--profile work` / `PI_OUTPOST_PROFILE=work` reads `~/.config/pi-outpost/profiles/work.json`. Nothing about the format changes — a profile *is* a config file, so everything documented about config applies to it, and `--config ~/.config/pi-outpost/profiles/work.json` is exactly equivalent. The alternative (a `profiles: {…}` map inside one file) would invent a config shape that exists nowhere else in the project, and would make the "first found wins" rule read on two different axes at once.

`--profile` and `--config` together is an error: two explicit answers to the same question.

### No config, no server

Without a config file the server refuses to start and prints how to make one (`pi-outpost init`, or `--global`). Today it starts as a plain local pi: agent cwd = launch directory, full toolset, bash enabled. That is a reasonable default for someone who cloned the repo and knows what they are running, and a bad surprise for someone who typed `npx pi-outpost` in `~`.

The rule is single and unconditional — no "except for the dev server", no `--defaults` escape hatch that becomes the thing everyone pastes. The repository therefore ships a committed `pi-outpost.config.dev.json` (agent cwd = the repo, sandbox off, port 3141), and `npm run dev` passes `--config` explicitly. The clone workflow keeps working, and it works *through the same code path* users get.

The test harness already writes a config and sets `PI_OUTPOST_CONFIG` (`server/test/harness.mjs:61`), so the suite is unaffected.

### A grant may not be widened from outside the file that grants it

`sandbox.root` defaults to `cwd`. Once `--cwd` and `PI_OUTPOST_CWD` exist, that default becomes a hole: a file saying `{ "cwd": ".", "sandbox": { "allowWrite": true } }` — the documented way to scope write access to your project — turns into *write access to `/`* if an inherited variable sets `PI_OUTPOST_CWD=/`. The security policy lives in the file; an environment variable nobody can see from that file rewrites it.

So: a sandbox that **grants** write or bash and names no `root` **refuses** a cwd override. Naming the root is one key, and it makes the grant state its own reach. A **read-only** sandbox has no such hazard and simply follows the workspace — moving where the agent works is exactly what `--cwd` means, and the read scope should move with it.

The effective sandbox (`root`, write target, bash) is logged at every start. `[config] loaded <path>` alone became a half-truth the moment the sandbox could be shaped from outside that path.

### `init --global` writes no directories at all

`.` in a config file resolves against the file's directory. In `~/.config/pi-outpost/config.json` that is the config directory — so a global config with `cwd: "."` would pin the agent to `~/.config/pi-outpost` from wherever you run it (the opposite of what "global" promises), and the moment the user flips `allowWrite: true` the agent's writable root would *contain the file defining its own sandbox*. It could grant itself bash for the next run.

The global starter therefore omits `cwd` and `sandbox.root`, letting both fall back to the launch directory — which is what "configure once, run anywhere" actually means.

### Off loopback, the token stops being advice

The docs have long said a token is "mandatory in practice" when `host` is not loopback. Nothing enforced it: the WebSocket accepts connections with no `Origin` (a local process already has shell access, so the check would be theatre), and an unset token makes `tokenValid()` return true for everything. `--host` and `PI_OUTPOST_HOST` turn that deliberate file edit into one word — so the server now refuses to listen off loopback without a token.

### Profile names are names, not paths

`--profile ../../../etc/evil` would escape `profiles/` through `path.join`. Names match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Combined with `PI_OUTPOST_PROFILE`, the unvalidated version let an environment variable alone load an arbitrary JSON file from anywhere on disk as the entire configuration.

Relatedly, the discovery order has **six** steps, not four: the profile forms sit next to their `--config`/`$PI_OUTPOST_CONFIG` equivalents (flag pair first, env pair second). And `--config` + an *inherited* `PI_OUTPOST_PROFILE` is not a conflict — flag beats env, so the flag simply wins. Only two *flags* naming a configuration is a mistake worth stopping for.

### Argv parsing with `node:util` `parseArgs`

Built in since Node 18, no dependency, and the CLI's surface is small (seven flags, one subcommand). A framework would be more code than the thing it parses.

`pi-outpost init [--global] [--force]` writes a starter config — the current directory's `pi-outpost.config.json`, or `~/.config/pi-outpost/config.json` with `--global` — and refuses to overwrite an existing file without `--force`. It prints the path it wrote and the command to start.

## Risks / Trade-offs

- **Two breaking changes in one release** (`PORT` precedence; refusing to start without a config). → Both are pre-1.0, both are in the release notes, and both trade a silent surprise for a loud one. The refusal prints the exact command that fixes it.
- **A 4th config location (`~/.config`) is action at a distance** — a `npx pi-outpost` in a directory with no file will now pick up a user-level file the user may have forgotten. → Mitigated by the existing "loaded <path>" log line, which becomes load-bearing rather than decorative.
- **The bundle ships pinned copies of the SDK and Fastify.** A user cannot patch a dependency without a new release. → Accepted: that is what makes `npx` work without a build, and it is already the deal the SEA build makes.
- **Package size**: the server bundle plus `web/dist` (mermaid, highlight.js, katex) is several MB. → `npx` caches it; and it is the same payload the clone downloads through `npm ci`, minus the dev dependencies.
- **`web/dist` must be built before `cli/` packs.** A stale or missing `web/dist` would publish a CLI that serves nothing. → `cli`'s `prepack` builds `web` and the bundle, and the release workflow builds from a clean checkout; the pack step fails loudly if `dist/web/index.html` is absent.
