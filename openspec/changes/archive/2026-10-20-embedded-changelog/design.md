# Design

## Inlined, not shipped as a file

The executable has no package directory to read a file from, so the text is inlined at
build time through an esbuild `define`, as `__PI_OUTPOST_VERSION__` already is. A source
run has neither, and its version (`dev`) is not comparable, so it shows nothing.

## The marker

`<agentDir>/outpost-version.json` holds `{ version, updatedFrom? }`, beside the update
check's cache. `updatedFrom` is kept for as long as the updated version runs, so a restart
before anyone opened the app does not lose the news; dismissal is per browser
(`localStorage`, keyed by the version), as the update notice's already is. Other cases:

| Marker | Running | Result |
|---|---|---|
| none, no update-check cache | X | first run: record X, say nothing |
| none, update-check cache present | X | ran before the marker existed: from = the release before X in the changelog |
| older Y | X | record `{X, from Y}`, say Y → X |
| X with from Y | X | say Y → X again |
| newer Z | X | downgrade: record X, say nothing |

The version is recorded before the update check runs: the check writes the cache that
stands for an earlier run, and answering first would make a first run look like a second.

## Release notes

`gh release create --notes-file` with `--generate-notes` prepends the file to GitHub's
generated list, so the release page keeps the PR list and gains the prose. The section is
extracted by a dependency-free script the workflow can run before `npm ci`'s products are
needed; it reads the heading with the same pattern as `server/src/changelog.ts`.
