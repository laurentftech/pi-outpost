# Developing pi-outpost

Everything here is for people working *on* pi-outpost. Running it is covered by the
[README](../README.md).

## Layout

```
shared/  protocol types, structured-exchange schema and the figure geometry
server/  Fastify + ws, agent runtimes, sandbox, file/git/document tools
ui/      React components and hooks (@pi-outpost/ui), consumed by web/ and embed/
web/     the standalone app (React + Vite + Tailwind)
embed/   @pi-outpost/embed, the Shadow-DOM widget
e2e/     Playwright suites
```

## Running from the repository

```bash
npm install
npm run dev
```

- Web UI: http://localhost:5173 (Vite dev server, proxies `/ws`, `/branding`, `/health`)
- Agent server: ws://127.0.0.1:3141/ws

`npm run dev` passes the repository's committed
[`pi-outpost.config.dev.json`](../pi-outpost.config.dev.json) — the same code path and the
same "no config, no start" rule as any other deployment, with no special case for
developers.

`npm run start` builds `web/dist` once and serves everything from a single process, using
*your* configuration rather than the dev one. There is no hot reload in that mode: rebuild
(`npm run build --workspace web`) and restart after a UI change.

## Tests

```bash
npm run test --workspace server        # integration tests: no model auth, no tokens spent
npm run test --workspace ui            # component unit tests (vitest, jsdom, testing-library)
npm run test:e2e                        # real built app in Chromium, including multi-project flows
npm run test:live --workspace server   # drives real agent turns (needs model auth, costs tokens)
npm run test:linux                     # the ubuntu CI leg — suite then coverage — on Linux, non-root
```

Server integration tests boot a real server against a throwaway workspace (isolated
`agentDir`, so your own sessions and extensions are never touched) and talk to it over
HTTP/WebSocket. See [`server/test/README.md`](../server/test/README.md).

Outcome uses the shared WebSocket protocol rather than a generated prose field. The client sends
`{ "type": "get_outcome", "requestId": "…" }`; the bound workspace replies only to that
connection with `{ "type": "workspace_outcome", "requestId": "…", "outcome": … }`.
`outcome.workspaceRoot` and `outcome.sessionId` are authoritative correlation fields. Consumers
must reject a response whose request, workspace, or session no longer matches their active view.
The payload is a list of ordered structured sections and closed navigation-target variants—never
HTML or executable actions. See `shared/src/outcome.ts` and `shared/src/protocol.ts` for the
canonical message and section shapes.

UI component tests run under vitest with jsdom and `@testing-library/react`, covering
`ui/src/components/` and `ui/src/util/`. They need no model auth and cost no tokens.

Playwright builds and drives the real standalone app and widget. Use it for any change
to visible behaviour or to the way a user operates the interface; assert the resulting
DOM, persisted files, or transcript rather than relying on a screenshot. Multi-project
activity and attention changes belong here because unit fakes cannot prove that switching
projects preserves the server's authoritative state or its isolation boundary.

### Why `test:linux` exists

It needs Docker, and it catches a class of bug a macOS or Windows checkout cannot see —
because there the bug does not fail, it *passes*. A test asserting "this path cannot be
written" by naming `/proc/...` succeeds instantly where there is no `/proc`; on Linux the
write never returns, the runner then reports every test as passing and prints no summary,
because a test file that never exits never reports. Run it before pushing anything that
touches paths, permissions, signals, or file watching.

It runs both server steps of the ubuntu leg — `npm test --workspace server` and then
`npm run test:coverage --workspace server` —
because each has gone red on its own while the other was green, and coverage runs on no
other platform. That step once failed on `main` with 1250 tests passing and none failing:
npm children spawned by the code under test inherited `NODE_V8_COVERAGE`, were killed at
their timeout mid-write, and the parent's reporter died parsing the truncated file. Nothing
short of running the real step would have shown it.

The fix for that was incomplete, and the job kept failing the same way now and then. Deleting
`NODE_V8_COVERAGE` from a child's environment does nothing: node's `child_process` copies the
parent's value into any environment that does not name the key. Only an explicit empty value
turns coverage off in the child. So a child a test starts gets `envWithoutCoverageSink()` from
`server/test/childEnv.mjs`, or names `NODE_V8_COVERAGE: ""` itself, and
`testChildEnvironment.test.ts` refuses any launch of `process.execPath` that does neither. The
size made it likely rather than rare: a child that loads pdf.js writes about ten megabytes of
coverage, nearly all of it source maps, and node writes that file in a single write.

The same weight sat in every test process that loads pdf.js itself. With `NODE_V8_COVERAGE`
set, node stores each loaded module's source map in the coverage file: tsx inlines a
word-by-word map for the dynamic imports it rewrites in pdf.js, and pdf.js ships its own `.map`
files besides — about 8 MiB of a 9.7 MiB file, for code the report never shows. So
`test:coverage` loads `server/test/stripDependencySourceMaps.mjs` after tsx: a load hook that
removes every `sourceMappingURL` comment from modules under `node_modules`, and nothing else.
Our own maps stay, since the report reads lines through them. The largest coverage file of the
unit suites went from 9.7 MiB to under 5 MiB.

It runs as a non-root user on purpose: as root, every "refuses an unwritable path"
assertion in this repository passes for the wrong reason. Dependencies are cached in a
Docker volume and reinstalled only when `package-lock.json` changes, so a second run costs
about what a local one does. `--fresh` ignores that cache; `--shell` drops you into the same
container; any other arguments replace the command, which is how you run one step at a time
while iterating:

```bash
npm run test:linux -- npm test --workspace server
```

### Driving the real app

`npm run bench` (`scripts/embed-bench.mts`) leaves a real widget running: a host page on its
own origin with hostile CSS, the servers behind it, and a seeded transcript with diagrams
and tables. Rebuild `web`, then `@pi-outpost/embed`, then `build:e2e-host` first — the bench
serves `dist/`, so an unbuilt fix is invisible.

## Building the widget

```bash
npm run build --workspace @pi-outpost/embed
```

Outputs ESM + CJS to `embed/dist/` plus a rolled-up `.d.ts`, ready to publish `embed/` to
your own registry.

## Specifications

Behaviour is specified under [`openspec/specs/`](../openspec/specs), one directory per
capability, and changes in flight live under `openspec/changes/`. A feature is not done
until every applicable `#### Scenario:` is covered by a test that would fail if the
behaviour broke.

## Releasing

A release is a version tag. Pushing `vX.Y.Z` runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds the
executables, publishes `pi-outpost` (`cli/`) and `@pi-outpost/embed` (`embed/`) to npm, and
creates the GitHub Release with the executables attached. Everything before the tag is done
by hand, on `main`.

1. **Merge first.** Every PR meant for the release is merged, and CI on `main` is green.
   Pull `main` locally; the working tree must be clean.
2. **Choose the version.** A `feat` since the last tag makes it a minor release, fixes
   alone a patch. A prerelease (`0.27.0-beta.1`) is published under its own identifier and
   never under `latest` — [`scripts/release-channel.mjs`](../scripts/release-channel.mjs)
   derives the channel from the version.
3. **Bump both packages.** Set the same version in `cli/package.json` and
   `embed/package.json`. Leave `web/`, `server/`, `ui/` and `shared/` alone: they are not
   published.
4. **Update the lockfile with npm 11**, the npm CI runs:

   ```bash
   npx -y npm@11 install --package-lock-only
   git diff package-lock.json   # only the two workspace versions
   ```

   A bump that skips this leaves the lockfile behind, and the next `npm install` rewrites
   it inside an unrelated PR. Do not use npm 12 here: it also drops `hasShrinkwrap` from
   `@earendil-works/pi-coding-agent`, whose published package does carry a shrinkwrap.
5. **Commit and push to `main`:**

   ```bash
   git add cli/package.json embed/package.json package-lock.json
   git commit -m "chore(release): vX.Y.Z"
   git push origin main
   ```

6. **Tag that commit and push the tag:**

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Annotated, because a lightweight `git tag vX.Y.Z` fails with `fatal: no tag message?`
   wherever `tag.gpgsign` is on — git signs annotated tags only, so it refuses rather
   than create an unsigned one.

   The workflow refuses to publish when the tag disagrees with the packages' versions,
   and skips a package already on npm at that version.
7. **Watch the run** (`gh run watch`). The executables for macOS arm64, Linux x64 and
   Windows x64 build first and gate the publish; the publish job then reruns typecheck,
   lint, both suites, the CSS, embed and CLI checks and the e2e suite before anything reaches
   npm.
8. **Check the result.** `npm view pi-outpost@X.Y.Z version` and
   `npm view @pi-outpost/embed@X.Y.Z version`. The CLI is about 25 MB and can take a few
   minutes to show on npm after the publish log says it is done — trust the log before an
   immediate 404. The GitHub Release carries notes generated from the merged PRs, and three
   executables.

The executables can be built from any branch without publishing anything, to check a
change to the single-executable build before it meets a tag: run the *Release* workflow by
hand (`gh workflow run release.yml --ref <branch>`), `executables_only` left on.

OpenSpec changes are archived when their PR merges, not at release time — from `main`,
never from the feature branch, or the main specs would claim what `main` does not have.
