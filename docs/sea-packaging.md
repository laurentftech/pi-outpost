# Packaging pi-outpost as a Windows executable (Node SEA)

Node's [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
(SEA) feature bundles the server into one `.exe` with the Node runtime baked
in — end users need nothing installed, no `npm install`, no terminal.

This is **experimental** and has one confirmed limitation (below). It was
validated end-to-end in this repo (bundle → blob → run, including extension
loading), but the final Windows-only steps (injecting into a real `node.exe`,
code-signing) haven't been — verify on a real Windows machine before
distributing.

## Known limitation: `pi-outpost.config.json`'s `extensionPaths` doesn't work

Extensions loaded via `extensionPaths` are loaded dynamically at runtime by
the SDK's `jiti`-based loader. That does not survive being bundled into a
single file — confirmed by testing: the bundled server starts fine, no error
is printed, but the extension silently registers zero commands.

**Fix**: add extensions as static imports in `server/src/sea-extensions.ts`
instead:

```ts
import myExtension from "../extensions/my-extension.ts";

export const seaExtensionFactories: ExtensionFactory[] = [myExtension];
```

This goes through the SDK's `resourceLoaderOptions.extensionFactories`
instead of `additionalExtensionPaths` — the SDK calls the function directly,
no dynamic loading involved, so esbuild can bundle it like any other import.
The tradeoff: the set of extensions is fixed at build time (a real static
`import` needs a literal path) — no dropping new extension files in after
packaging. For a fixed Windows build handed to end users, that's normally
what you want anyway.

`sea-extensions.ts` is empty by default and has no effect on the normal
`npm run dev` / `npm run start` flow, which still reads `extensionPaths`
from config as usual.

## Also worth knowing

`pi`'s own self-referential docs (answering questions about pi's SDK,
extensions, etc. — see the default system prompt) read `README.md`/`docs/`/
`examples/` from the SDK's package directory, resolved relative to the
*bundled* file's location once packaged. Those files aren't shipped by
default, so that specific feature silently stops working — harmless unless
you rely on it. Fixable by setting `PI_PACKAGE_DIR` (env var, read by the
SDK) to wherever you copy `node_modules/@earendil-works/pi-coding-agent`'s
`README.md`/`docs/`/`examples/` alongside the executable, if you need it.

## Build the blob

```bash
npm run build --workspace web   # produces web/dist
npm run build:sea --workspace server
```

Produces, in `server/dist/`:
- `bundle.js` — the whole server in one file, no `node_modules` needed at runtime
- `sea-prep.blob` — Node's SEA blob, ready to inject

## Remaining steps (Windows only — not done by the script above)

```powershell
# 1. Start from a real Windows node.exe (same major version used to build the blob)
copy "C:\path\to\node.exe" pi-outpost.exe

# 2. Inject the blob (requires the `postject` npm package)
npx postject pi-outpost.exe NODE_SEA_BLOB server\dist\sea-prep.blob ^
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ^
  --overwrite

# 3. Re-sign (requires signtool + a code-signing cert) — postject invalidates
#    node.exe's original signature; an unsigned .exe reliably triggers
#    Windows SmartScreen for a downloaded file
signtool sign /fd SHA256 pi-outpost.exe
```

Then lay out the final folder so the server's existing static-file resolution
(`../../web/dist` relative to where the bundle lives) keeps working:

```
pi-outpost\
  pi-outpost.exe
  web\
    dist\            <- from `npm run build --workspace web`
  pi-outpost.config.json
```

`pi-outpost.exe` run from that folder serves the UI, `/ws`, `/branding`,
`/health` — same behavior as `npm run start`, just no Node.js install
required on the machine running it.
