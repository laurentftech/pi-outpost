## 1. Build

- [x] 1.1 Inline photon's wasm, QuickJS's wasm and codemode's worker into the bundle with an esbuild plugin that refuses when the replaced code has moved
- [x] 1.2 Use it in both bundles an executable is built from: `server/scripts/build-sea.mjs` and `cli/scripts/build.mjs`'s `pi-outpost.sea.mjs`

## 2. Coverage

- [x] 2.1 Bundle the real `read` tool and codemode tool like the executable and run them from an empty directory, with and without the plugin
- [x] 2.2 Write `scenario-coverage.md`; run `npm run check:scenarios` and `openspec validate --strict`
