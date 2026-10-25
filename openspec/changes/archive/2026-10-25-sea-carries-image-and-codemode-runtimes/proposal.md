## Why

In the standalone executable the agent could not see images or run codemode scripts.
`read` on a PNG returned "[Image omitted: could not be resized below the inline image size
limit.]" and the model described a picture it never saw; codemode failed with "Cannot find
module 'quickjs-wasi/quickjs.wasm'". A source run and the npm package worked, which is how it
went unnoticed.

The executable is one ESM bundle with nothing beside it, and three things the SDK loads are
files found relative to a module: photon's WebAssembly (`readFileSync(join(__dirname, …))` —
an ESM bundle has no `__dirname`, so photon never loads), QuickJS's `quickjs.wasm`
(`require.resolve`), and codemode's worker (`worker.js` beside the module).

## What Changes

- Both bundles an executable is built from (`server/scripts/build-sea.mjs`, the
  `pi-outpost.sea.mjs` of `cli/scripts/build.mjs`) inline the three: the wasm bytes into the
  code that reads them, the worker as a `data:` URL, as the SDK's own Node bundle does.
- Each replacement checks the code it replaces is still there; if the SDK changes it, the build
  stops instead of shipping an executable that silently loses images or codemode again.

## Capabilities

### Modified Capabilities

- `standalone-executable`: the agent's image reading and codemode work inside it.

## Impact

- `server/scripts/sea-inline-assets.mjs` (new), `server/scripts/build-sea.mjs`, `cli/scripts/build.mjs`.
- The executable grows by the inlined wasm (about 3.4 MB of base64).
