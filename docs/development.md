# Developing pi-outpost

Everything here is for people working *on* pi-outpost. Running it is covered by the
[getting-started guide](getting-started.md).

Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for contributions and PR expectations.
[Code quality](quality.md) describes the CI checks, warning budget, coverage exclusions and current
merge-enforcement limits. Report suspected vulnerabilities through [SECURITY.md](../SECURITY.md).

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
npm install -g npm@12.2.2
npm ci
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

## Server tests on Windows

`npm test --workspace server` discovers every `test/*.test.mjs` and `test/*.test.ts`
file. On Windows it runs the normal batch in parallel, then the `terminal*.test.*`
files separately with one test worker. All files still run, including after a failure
in the first batch, and any failed batch makes the command fail. Tests of concurrent
opens within a server retain their own concurrency and assertions.

This isolates real Windows consoles from unrelated test-process churn while
[`node-pty`'s ConPTY teardown race](https://github.com/microsoft/node-pty/issues/1007)
remains unresolved. Linux keeps the full parallel suite and its coverage command.

## npm 12 installation regression checks

After `npm run build --workspace cli`, run `npm run test:npm-install` with npm 12.2.2.
It packs the built CLI and checks fresh global and npx installs, an actual native terminal,
and refusal of an unrelated lifecycle script. CI runs this on Linux, Windows and macOS.
The test uses temporary prefixes, caches and npm configuration and removes them afterwards.
Cold installs have a ten-minute budget each, including dependency download and extraction.
The installed application keeps separate, shorter startup and terminal deadlines.

## Dependency maintenance

Use npm 12.2.2 locally and in CI. Regenerate `package-lock.json` with that version
when changing dependencies. Review install-script changes explicitly: `npm
approve-scripts --allow-scripts-pending` lists undecided packages. The committed
`allowScripts` policy allows reviewed native/build scripts and denies the Google
SDK no-op and protobufjs version advisory. `.npmrc` rejects unreviewed scripts. Keep the
Playwright container tag in `.github/workflows/ci.yml` aligned with the locked
`@playwright/test` version.

### The pinned npm

CI, the release workflow and the Dockerfiles do not run `npm install -g npm@12.2.2`: that
fetches whatever the registry serves under that version. They install npm from
[`tools/npm`](../tools/npm/package.json) with `npm ci`, so the tarball is checked against the
integrity hash in its `package-lock.json`, and put `tools/npm/node_modules/.bin` first on
`PATH`. Workflows use the [`setup-npm`](../.github/actions/setup-npm/action.yml) action,
which also fails if the `npm` on `PATH` is not the pinned version.

`tools/npm/.npmrc` sets `allow-remote=all` for that project only. npm 12 reads the
dependencies npm bundles from its release tarball by URL, which its default
`allow-remote=none` refuses; the tarball is still verified against the lockfile hash.

`deploy/docker` is built with its own directory as the context, so it carries an identical
copy in `deploy/docker/npm`. `npm run test:scripts` fails if the copies differ, if the pinned
version differs from `packageManager`, or if a workflow or Dockerfile installs npm by version.

To move to another npm version, change it in `tools/npm/package.json`, then:

```bash
npx -y npm@<version> install --prefix tools/npm --allow-remote=all --no-audit --no-fund
cp tools/npm/package.json tools/npm/package-lock.json deploy/docker/npm/
```

Run a full install, not `--package-lock-only`. Without the tarball, npm cannot see the versions
it bundles and writes stale ones into the lockfile: for npm 12.2.2 it recorded `undici` 6.29.0
and `ip-address` 10.7.2, while the tarball ships the fixed 6.29.1 and 10.7.5, so `npm audit` and
Dependabot reported advisories that did not apply (corrected in #453). To check a lockfile, compare
it with what the install put in `tools/npm/node_modules/npm/node_modules`.

Then update `packageManager`, `engines.npm` and the version named in this guide,
[CONTRIBUTING.md](../CONTRIBUTING.md) and the `deploy/docker/test.mjs` check, in one commit.

The browser CI container needs both `build-essential` and `python3` to compile
`node-pty` on Linux. Its install step shows lifecycle output and checks that the
native terminal binding loads before building: npm can silently omit this optional
dependency when compilation fails.
APT network waits in this job are bounded, with retries and a five-minute cap for each update/install
command. A stalled mirror must fail with diagnostics rather than consume the whole CI run.

Keep jsdom on `~30.0.1` for now: 30.1.2 breaks the Blob/object-URL path used by
the Mermaid raster export tests (`Cannot read properties of undefined (reading
'_buffer')`). Revisit this pin with those tests and the running-app export checks.

Keep the direct TypeBox dependency at 1.3.18 until its generated validators and
diagnostics can be migrated together. The 1.3.37 update changes both emitted
validator code and the paths reported for invalid input; the existing contract
tests intentionally check those details.

The root `overrides` move `rehype-katex` and `micromark-extension-math` onto
KaTeX 0.18 to avoid the prototype-pollution trust bypass in older KaTeX releases
([GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)).
When changing these overrides, verify inline and display math in the running app
and the document exports. Remove them when the plugins depend on a fixed version.

`npm audit` also reports `sprintf-js` through API Extractor's argument parser
([GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)).
At this update, npm has no patched `sprintf-js` release. Do not apply the unrelated
package downgrades suggested by `npm audit fix --force` as a substitute for a fix.

## Tests

```bash
npm run test --workspace server        # integration tests: no model auth, no tokens spent
npm run test --workspace ui            # component unit tests (vitest, jsdom, testing-library)
npm run test:e2e                        # real built app in Chromium, including multi-project flows
npm run test:webbench                   # core app/widget flows in Chromium, Firefox and WebKit, plus WCAG 2.2 AA scans
npm run test:live --workspace server   # drives real agent turns (needs model auth, costs tokens)
npm run test:linux                     # the ubuntu CI leg — every server suite, instrumented — on Linux, non-root
npm run test:coverage --workspace server   # the same step directly, on Linux or macOS
```

Install the three Playwright engines once with `npx playwright install chromium firefox webkit`.
The web bench exercises the standalone app, assistant-rendered content, the embedded widget,
document-tool reuse after session resume, and queued-prompt recovery after repeated interruptions
in each engine. Its axe scans cover the standalone app's initial screen and Settings panel;
automated checks are a useful baseline, not a substitute for keyboard and assistive-technology
review.

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

It runs the ubuntu leg's server step, `npm run test:coverage --workspace server`: every
server suite, instrumented, which runs on no other platform (see [Coverage](#coverage)). A
coverage run once failed on `main` with 1250 tests passing and none failing: npm children
spawned by the code under test inherited `NODE_V8_COVERAGE`, were killed at their timeout
mid-write, and the parent's reporter died parsing the truncated file. Nothing short of
running the real step would have shown it.

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

### Coverage

Three steps, run in this order on Ubuntu CI and locally on Linux or macOS:

```bash
npm run test:coverage --workspace server   # every server suite, instrumented → server/coverage/raw
npm run test:coverage --workspace ui       # every UI suite, through vitest-monocart-coverage → ui/coverage/raw
node scripts/coverage-report.mjs           # merge, inventory check, thresholds → coverage/
node scripts/coverage-summary.mjs coverage/coverage-scopes.json   # the table CI shows
```

Both sides leave monocart-coverage-reports (MCR) raw data, and
[`scripts/coverage-report.mjs`](../scripts/coverage-report.mjs) merges it over the scopes in
[`scripts/coverage-config.mjs`](../scripts/coverage-config.mjs): `server/src`, `shared/src` and
`ui/src`, a file no test loads at 0%, minus the exclusions listed there with their reasons. MCR
merges the raw V8 data of every process before converting it, so a `shared/src` file run by
server and UI suites gets one total and the union of their hits. The report fails below a
scope's thresholds, or if an inventory file with code is missing from it.

What the report counts, and why:

- **The code V8 ran.** A coverage file holds byte ranges into the JavaScript tsx produced, not
  that JavaScript. In a coverage run the load hook `server/test/stripDependencySourceMaps.mjs`
  keeps tsx's output for `server/src` and `shared/src` under `<coverage dir>/sources/`, and
  `server/test/coverageConvert.mjs` hands it to MCR, which reads functions and branches from it
  and maps them back to the TypeScript. Files no suite loads are compiled with esbuild so they
  count their functions and branches too.
- **Lines of code only.** MCR also reports lines TypeScript erases as covered; the report
  recomputes each file's lines over those its compilation maps back to. A types-only file has
  none and is not owed.
- **No statements.** MCR counts them from the generated code's lines, and tsx emits a module on
  one line while Vite does not.

`ui/mcr.config.mjs` holds the UI side's MCR options; Vite names the UI's own files from `ui/`,
and the report puts them back under `ui/src`.

The integration suites' servers are measured too, which takes three things from the harness,
all switched on by `PI_OUTPOST_TEST_COVERAGE_DIR` and by nothing else:

- the server gets the run's directory as `NODE_V8_COVERAGE`, through `serverCoverageSink()` in
  `server/test/childEnv.mjs`, the one launch `testChildEnvironment.test.ts` lets name a sink;
  the agent, terminal and npm children the server starts still blank it;
- `stop()` gives it 15 s after SIGTERM, instead of 300 ms, to shut down and write its coverage
  on `process.exit`;
- as soon as it has stopped, `server/test/coverageFilter.mjs` cuts its file down to the
  inventory's roots: about 20 MB raw, mostly dependencies' source maps, of which ours are a
  few MB. A file a killed process left half-written is set aside and named, never parsed by
  the report.

The server step is Linux and macOS only: on Windows the harness ends a server with
`taskkill /F`, which leaves it no exit to write coverage on, so the script refuses to run there.
CI runs it on Ubuntu in place of `npm test`; Windows runs `npm test`, uninstrumented.

### Driving the real app

`npm run bench` (`scripts/embed-bench.mts`) leaves a real widget running: a host page on its
own origin with hostile CSS, the servers behind it, and a seeded transcript with diagrams
and tables. Rebuild `web`, then `@pi-outpost/embed`, then `build:e2e-host` first — the bench
serves `dist/`, so an unbuilt fix is invisible.

### Fuzzing

The parsers that read untrusted bytes are fuzzed with
[Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js), one target each in
[`fuzz/targets/`](../fuzz/targets):

| Target | What it reads | Not a finding |
| --- | --- | --- |
| `mail` | an `.eml` or `.msg` file, through `readMessage` | a `MailError` |
| `zip` | an Office document's zip, through `readAllZipEntries` | a `ZipError` |
| `structured-exchange` | a model's structured exchange document, through the whole gate | nothing: the gate never throws |

Anything else thrown, a hang or a crash is a finding. The seeds are the repository's own
fixtures and the structured-exchange conformance suite, gathered by `fuzz/build.mjs`.

- **On a pull request** touching those parsers, `fuzz/` or `.clusterfuzzlite/`
  (`.github/workflows/fuzz-pr.yml`), every target runs for 100 seconds.
- **Daily on `main`** (`fuzz-batch.yml`), every target runs for twenty minutes.

Both run [`fuzz/run.mjs`](../fuzz/run.mjs), which runs each target in turn for a given number of
seconds, growing its corpus from the seeds. A finding fails the job, names the target in an
annotation, and the job keeps the crashing input as the `fuzzing-artifacts` artifact. To fuzz
locally, and to reproduce a crash with the bundled target:

```sh
node fuzz/build.mjs
(cd fuzz && npm ci)
node fuzz/run.mjs 60 mail          # one target for a minute; omit the name for all of them
npx --prefix fuzz jazzer fuzz/build/mail.js crash-<id>
```

The targets run in Jazzer.js's default mode, not `--sync`. Synchronous mode never turns Node's
event loop, so what Node frees there is never freed: a zlib engine destroyed on damaged data
piled up until the zip target ran out of memory, in a reader that does not leak.

Jazzer.js runs directly rather than through ClusterFuzzLite's GitHub actions, which cannot fuzz
JavaScript: their configuration accepts only the `address`, `memory`, `undefined` and `coverage`
sanitizers, OSS-Fuzz's JavaScript builder refuses every sanitizer but `none` and `coverage`, and a
`coverage` run produces a coverage report without fuzzing.

`fuzz/` is not a workspace: its own lockfile keeps Jazzer.js out of the product's dependency
tree, and the targets are bundled with every dependency inlined, for the Node 20 that OSS-Fuzz's
runner uses. `.clusterfuzzlite/` is laid out as an OSS-Fuzz project, so it can be submitted
there unchanged. A new target is a `fuzz/targets/<name>.fuzz.ts` exporting `fuzz(data: Buffer)`,
an entry in `TARGETS` in `fuzz/build.mjs`, and its name in `ALL` in `fuzz/run.mjs` and in
`.clusterfuzzlite/build.sh`.

## When a turn dies of stack exhaustion

`server/src/turnFailureLog.ts` writes a census of the *input* to
`<agentDir>/turn-failures.jsonl` — counts, byte sizes, nesting depths, roles and tool
names, never message text — because a stack overflow is a deterministic function of what
it was handed. What it cannot record is the trace, and the reason is upstream: every
pi-ai provider's stream loop ends in a catch that keeps `error.message` and drops the
`Error`. `normalizeProviderError` hands back a flat struct with no stack in it,
`after_provider_response` fires before the stream is consumed, and V8 has no hook at an
`Error`'s construction — `prepareStackTrace` runs on the first read of `.stack`, which
never happens.

The probe reads it before the catch can drop it:

```bash
PI_OUTPOST_PROVIDER_STACK=1 npm run dev --workspace server 2> pi-stderr.log
```

`providerStackHook.mjs` is passed with `--import` from the `dev` and `start` scripts —
the only slot early enough, since the whole module graph is loaded before any of
pi-outpost's own code evaluates. It is inert unless the variable says otherwise: off, it
reads one environment variable and returns, registers nothing and rewrites nothing.

On, it registers a load hook that rewrites that catch **in memory**, matched on the
catch's own line rather than on a filename, so it arms every provider that shares it.
Nothing under `node_modules` is touched and `npm ci` has nothing to undo. It also raises
`Error.stackTraceLimit` to 200: V8's default of ten frames is nothing on a recursion,
where the repeated frame is the answer.

The trace goes to two places, because they answer different questions.
`[pi-outpost] provider stack:` on stderr is what someone watching a terminal sees. The
same stack is also attached to the assistant message as a `provider_transport_failure`
diagnostic — the shape `pi-messages` and `openai-codex-responses` already produce, and
what an upstream fix would add here — so it reaches `censusOfTurn`, which records
`diagnostics` verbatim. The trace then lands in `turn-failures.jsonl` beside the census
of the input it belongs to, rather than having to be matched to it by timestamp.
`details.source` on the diagnostic says the probe attached it, so it is never mistaken
for something the SDK produced. Either way it is function names and file paths: no
message content, no tool arguments.

Two things it will not do. It does not change what the agent sees: the probe is
prepended to the assignment, which still runs, so the turn fails exactly as it did. And
it cannot reach inside a `--build-sea` executable, where the SDK is bundled rather than
resolved — for the npm install the SDK stays external, so there it works.

If a future SDK rewrites that catch, the hook matches nothing and says nothing false: the
startup line warns that no probe reporting in by the first model call means exactly that.
A census recorded without the probe armed prints the flag to set.

For the installed CLI, the same file ships beside the bundle:

```bash
PI_OUTPOST_PROVIDER_STACK=1 NODE_OPTIONS="--import <prefix>/pi-outpost/dist/providerStackHook.mjs" pi-outpost
```

## Building the widget

```bash
npm run build --workspace @pi-outpost/embed
```

Outputs ESM + CJS to `embed/dist/` plus a rolled-up `.d.ts`, ready to publish `embed/` to
your own registry.

## The structured-exchange skill has two readers

`skills/structured-exchange/references/*.md` is read by pi-outpost's agent as files, and served to
Open WebUI's models by pi-outpost's Open WebUI server (`apps-core/src/guide.ts`, `read_structure_guide`). A
passage that only makes sense with pi-outpost's tools — writing figure or table files, comparing
timeline files — goes between `<!-- only: pi-outpost -->` and `<!-- end -->`, each on its own line;
that server leaves it out. `openwebui/test/guide.test.ts` fails if a served page names a
tool Open WebUI's models do not have.

## Specifications

Behaviour is specified under [`openspec/specs/`](../openspec/specs), one directory per
capability, and changes in flight live under `openspec/changes/`. A feature is not done
until every applicable `#### Scenario:` is covered by a test that would fail if the
behaviour broke.

## Releasing

A release is a version tag. Pushing `vX.Y.Z` runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds the
executables, publishes `pi-outpost` (`cli/`) and `@pi-outpost/embed` (`embed/`) to npm, and
creates the GitHub Release with the executables and the Claude Desktop bundles
(`pi-outpost-plannings.mcpb` and `pi-outpost-posters.mcpb`, at the release's version) attached. Everything before the tag is done
by hand, on `main`.

1. **Merge first.** Every PR meant for the release is merged, and CI on `main` is green.
   Pull `main` locally; the working tree must be clean.
2. **Choose the version.** A `feat` since the last tag makes it a minor release, fixes
   alone a patch. A prerelease (`0.27.0-beta.1`) is published under its own identifier and
   never under `latest` — [`scripts/release-channel.mjs`](../scripts/release-channel.mjs)
   derives the channel from the version.
3. **Write the changelog.** Add a `## [X.Y.Z] - YYYY-MM-DD` section at the top of
   [`CHANGELOG.md`](../CHANGELOG.md): what a user notices, grouped under `### Added`,
   `### Changed` and `### Fixed`, each line linking its PR with an absolute URL. The file is
   inlined into the package and the executables, and the app shows these sections after an
   update, offline — write them for the person who just updated, not for a reviewer. The
   section also becomes the GitHub Release's notes, ahead of GitHub's list of merged PRs.
   `npm run test:scripts` fails while the version the packages are at has no section, and
   the release workflow refuses to publish without one.
4. **Bump both packages.** Set the same version in `cli/package.json` and
   `embed/package.json`. Leave `web/`, `server/`, `ui/` and `shared/` alone: they are not
   published.
5. **Update the lockfile with npm 12.2.2**, the npm CI runs:

   ```bash
   npx -y npm@12.2.2 install --package-lock-only
   git diff package-lock.json   # only the two workspace versions
   ```

   Inspect the diff: a release-only version bump changes only the two workspace
   versions. Dependency changes may update lock metadata; review them with the
   install-script policy rather than regenerating with a different npm major.

6. **Commit and push to `main`:**

   ```bash
   git add CHANGELOG.md cli/package.json embed/package.json package-lock.json
   git commit -m "chore(release): vX.Y.Z"
   git push origin main
   ```

7. **Tag that commit and push the tag:**

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Annotated, because a lightweight `git tag vX.Y.Z` fails with `fatal: no tag message?`
   wherever `tag.gpgsign` is on — git signs annotated tags only, so it refuses rather
   than create an unsigned one.

   The workflow refuses to publish when the tag disagrees with the packages' versions,
   and skips a package already on npm at that version.
8. **Watch the run** (`gh run watch`). The executables for macOS arm64, Linux x64 and
   Windows x64 build first and gate the publish; the publish job then reruns typecheck,
   lint, both suites, the CSS, embed and CLI checks and the e2e suite before anything reaches
   npm.
9. **Check the result.** `npm view pi-outpost@X.Y.Z version` and
   `npm view @pi-outpost/embed@X.Y.Z version`. The CLI is about 25 MB and can take a few
   minutes to show on npm after the publish log says it is done — trust the log before an
   immediate 404. The GitHub Release carries notes generated from the merged PRs, three
   executables, the two Claude Desktop bundles, and `pi-outpost-X.Y.Z.sigstore.json`, the
   signed build provenance for all of them. Check one asset against it:
   `gh release download vX.Y.Z -p 'pi-outpost-X.Y.Z-linux-x64' && gh attestation verify pi-outpost-X.Y.Z-linux-x64 -R laurentftech/pi-outpost`.

   The *image* job pushes pi-outpost's Open WebUI server to
   `ghcr.io/laurentftech/pi-outpost-openwebui:X.Y.Z`, and to `latest` for a stable version. Check
   it with `docker manifest inspect ghcr.io/laurentftech/pi-outpost-openwebui:X.Y.Z`.

   The *app-image* job also publishes the full coding app with Python to
   `ghcr.io/laurentftech/pi-outpost:X.Y.Z` (Linux x64), plus `latest` for stable releases only.
   It consumes the built CLI tarball passed by the successful publish job, avoiding npm's
   propagation delay. Before any push, it checks the installed version and runs the real
   Docker confinement, Python, terminal, browser and persistence checks against that exact image.
   The image keeps its default non-root UID 1000; only the host-side temporary fixture harness
   runs as root to accommodate GitHub's different runner UID. The tarball is an internal workflow
   artifact; the release attachment job downloads only the five public `pi-outpost-*` artifacts.
   The workflow keeps its artifacts 7 days (the Release keeps the public files): re-running a
   failed *attach* or image job works within that week, after it the whole release must run again.
   A final anonymous manifest check must pass. Verify both image jobs before calling the release
   complete; deployment instructions are in [Docker with Python](docker.md).

   **It must be pullable without a login,** or the demo `docker-compose.yml` fails at the pull:
   `curl -s "https://ghcr.io/token?scope=repository:laurentftech/pi-outpost-openwebui:pull"` then
   the manifest with that token must answer 200. It came out public on its first publish (v0.34.0),
   inheriting the repository's visibility through the image's `org.opencontainers.image.source`
   label. Should it ever come out private, make it public in *Package settings → Change visibility*
   (GitHub's API cannot change a package's visibility). This first-publish visibility check applies
   to both packages; the full-app image job fails explicitly if anonymous access is unavailable.

The executables can be built from any branch without publishing anything, to check a
change to the single-executable build before it meets a tag: run the *Release* workflow by
hand (`gh workflow run release.yml --ref <branch>`), `executables_only` left on.

OpenSpec changes are archived when their PR merges, not at release time — from `main`,
never from the feature branch, or the main specs would claim what `main` does not have.

## Runtime architecture

```
shared/  (protocol types — events, ChatItem, DialogRequest)
         (structured-exchange: schema, validation, and the figure — one list of
          shapes both renderers draw, so neither can decide anything alone)

ui/  (React components & hooks)       server/  (Fastify + ws)
┌──────────────────────────┐          ┌──────────────────────────┐
│ @pi-outpost/ui exports   │          │ workspace registry       │
│ CopyButton, DiffBlocks,  │  /ws     │  └ per project: session, │
│ ToolCard, useAgent, …    │ ◄──────► │    sandbox, files, git   │
│                          │  JSON    │ agent runtime boundary   │
└────────┬─────────────────┘          │  ├ embedded AgentSession │
         │ import                     │  └ pi --mode rpc child   │
         ▼                            └──────────────────────────┘
web/  (React + Vite + Tailwind)     embed/  (Shadow-DOM widget)
┌──────────────────────┐            ┌──────────────────────────┐
│ Standalone app       │            │ @pi-outpost/embed        │
│ (mounts UI from ui/) │            │ (mounts UI from ui/)     │
└──────────────────────┘            └──────────────────────────┘
```

Sessions persist in `<agentDir>/sessions/`, per project — reconnecting clients receive the
full history of the project they are bound to.

**Single-tenant by design.** Everyone connected to a server shares the same projects and the
same conversations: there is one identity, not one per person. That is deliberate for a
personal deployment, and the thing to fix before a shared one — see [#4, multi-user
support](https://github.com/laurentftech/pi-outpost/issues/4).
