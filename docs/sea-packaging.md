# Packaging pi-outpost as a Windows executable (Node SEA)

Node's [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
(SEA) feature bundles the server into one `.exe` with the Node runtime baked
in — end users need nothing installed, no `npm install`, no terminal.

> **Requires Node ≥ 26** (for `--build-sea` + `mainFormat: "module"` support).

## Quick start (from npm)

The fastest way to get a standalone `.exe` is from the published npm package:

```powershell
# 1. Install pi-outpost anywhere with Node.js
npm install pi-outpost

# 2. Create a SEA config file
# (on Windows the output must end in .exe)
@'
{ "main": "node_modules/pi-outpost/dist/pi-outpost.sea.mjs",
  "output": "pi-outpost.exe",
  "mainFormat": "module" }
'@ | Out-File -Encoding utf8 sea-config.json

# 3. Build the executable (Node ≥ 26 only)
node --build-sea sea-config.json

# 4. Run it
.\pi-outpost.exe --version
```

The published npm package ships two bundles:
- `pi-outpost.mjs` (≈ 2 MB) — npm dependencies external, for `npx` / `npm start`.
- `pi-outpost.sea.mjs` (≈ 16 MB) — all dependencies inlined, for `--build-sea`.

## Build from source

```bash
npm run build --workspace web       # web UI
npm run build --workspace pi-outpost # produces both .mjs bundles in cli/dist/
npm run build:sea --workspace server # .exe + sea-prep.blob in server/dist/
```

The `build:sea` step in `server/scripts/build-sea.mjs`:
1. **Bundles** `server/src/index.ts` via esbuild into one ESM file (`bundle.mjs`).
2. **Generates a cross-platform blob** (`sea-prep.blob`) via `--experimental-sea-config`.
3. **On Windows only** (skipped in CI), builds a native `.exe` via `--build-sea`.

## Using the cross-platform blob (any platform)

The `sea-prep.blob` is included in the npm package and can be injected into
any Node.js binary of the same major version using postject:

```powershell
copy "C:\path\to\node.exe" pi-outpost.exe
npx postject pi-outpost.exe NODE_SEA_BLOB node_modules/pi-outpost/dist/sea-prep.blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 `
  --overwrite
signtool sign /fd SHA256 pi-outpost.exe   # re-sign after injection
```

> This is the legacy workflow. Prefer `--build-sea` (above) — no external tools needed.

## Extension loading with the SEA build

Config.`extensionPaths` loads `.ts`/`.mjs` files via the pi SDK's jiti
loader, which works inside a SEA binary (extensions are loaded from the
filesystem at runtime).

The `extensionScripts` config key loads `.mjs` files at runtime via native
`import()`, which esbuild preserves in the bundled output:

```json
{
  "noExtensions": true,
  "extensionScripts": ["./my-extension.mjs"]
}
```

Each file must default-export an `ExtensionFactory`:

```js
export default (pi) => {
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify("Hello!", "info");
    },
  });
};
```

Paths are resolved relative to the config file's directory, same as every
other relative path in the config.

### Static imports at build time (`src/sea-extensions.ts`)

For extensions that should be baked into the bundle itself (no external file
to deploy alongside the binary), add them as static imports in
`server/src/sea-extensions.ts`:

```ts
import myExtension from "../extensions/my-extension.ts";

export const seaExtensionFactories: ExtensionFactory[] = [myExtension];
```

This goes through the SDK's `extensionFactories` instead of `import()` — no
dynamic loading, so esbuild bundles it like any other import. The tradeoff:
the set of extensions is fixed at build time.

`sea-extensions.ts` is empty by default and has no effect on the normal
`npm run dev` / `npm run start` flow, which reads `extensionScripts` from
config as usual.

## Also worth knowing

- The `.exe` needs its own config file (`--config path/to/pi-outpost.config.json`)
  or one of the auto-discovery locations (see `--help`). Unlike `npm run dev`,
  there is no dev config fallback.
- `pi`'s self-referential docs (answering questions about pi's SDK) read
  `README.md`/`docs`/`examples/` from the SDK's package directory. Those
  aren't bundled into the SEA blob, so that feature silently stops working.
  Set `$env:PI_PACKAGE_DIR` to a copy of the SDK's doc directory if needed.
- On Windows, an unsigned `.exe` triggers SmartScreen for downloaded files.
  Sign it with `signtool sign /fd SHA256 pi-outpost.exe` before distribution.
