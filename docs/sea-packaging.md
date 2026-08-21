# Packaging pi-outpost as a Windows executable (Node SEA)

Node's [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
(SEA) feature bundles the server **and the built web UI** into one `.exe` with
the Node runtime baked in — end users need nothing installed, no `npm install`,
no terminal, and **no separate web/ folder** next to the executable. The UI is
inlined at build time into the bundle.

> **Requires Node ≥ 26** (for `--build-sea` + `mainFormat: "module"` support).

## The two ways to get one

**Download it.** Every release carries an executable per platform, under
[Releases](https://github.com/laurentftech/pi-outpost/releases): `pi-outpost-<version>-macos-arm64`,
`-linux-x64`, `-windows-x64.exe`. Nothing installed, nothing built.

No Intel macOS build: GitHub retired the `macos-13` runner, and a job asking for it
queues until it times out rather than failing. On an Intel Mac, build your own with
`npx pi-outpost build-exe` — it works, and it is what produced the executables this
feature was tested with.

On macOS and Linux, mark it executable first — a release asset is a plain HTTP
download, which carries no POSIX permission bits no matter what CI set them to, so
every download lands non-executable:

```bash
chmod +x pi-outpost-<version>-<os>-<arch>
```

Skip this and it fails closed rather than misleadingly: `Permission denied`, exit
126, nothing about signing or Gatekeeper. Windows needs no equivalent — a `.exe`
carries no execute bit to lose.

They are **not signed for distribution**, and no code fix closes that. The ad-hoc
signature above (`resignMacho`) satisfies Apple Silicon's kernel-level requirement
that a binary carry *some* signature to run at all — that's a different check from
Gatekeeper's, and does not satisfy it. Gatekeeper acts on the quarantine attribute a
browser or `curl` sets on anything downloaded from the internet, unrelated to the
`chmod` above, and it is not a dismiss-and-continue warning on first launch:

- **macOS** refuses to open a fresh download outright — not a warning dialog with an
  obvious way through. Clear it once with
  `xattr -d com.apple.quarantine ./pi-outpost-<version>-macos-<arch>`, or open it via
  Control-click → Open, or via System Settings → Privacy & Security, which surfaces
  an **Open Anyway** button once the first attempt has been blocked.
- **Windows** SmartScreen shows "Windows protected your PC" with only **Don't run**
  visible; click **More info**, then **Run anyway**. A managed/corporate machine may
  have that button removed by policy — there is no user-side bypass then.

Real signing means a paid Apple Developer ID plus notarisation, and a code-signing
certificate on Windows; neither is done here.

**Build it from the package you have:**

```bash
npm install pi-outpost
npx pi-outpost build-exe          # → ./pi-outpost (./pi-outpost.exe on Windows)
```

That is the whole procedure. The command writes the SEA config itself — including
the module format and an encoding without a byte order mark, the two details that
used to make this fail unreadably — builds, signs the result where the platform
requires it, and prints the path.

```
--out <path>   where to write it (default: ./pi-outpost, ./pi-outpost.exe on Windows)
--force        replace an existing file at that path
```

On **Node ≥ 26** it uses `node --build-sea`. On anything older it falls back to
injecting the shipped `sea-prep.blob` into a copy of your `node` binary with
`postject`, and says so — the two artifacts are not identical, and when one of them
misbehaves the first question is which one you have.

On macOS the result is signed ad-hoc (`codesign --sign -`). That is what makes a
modified binary *launch* at all: without it the kernel kills it, naming neither the
signature nor the remedy. It is not a distribution signature.

## Starting it

Running the executable starts the server and opens the interface in your default
browser, at the address it actually bound — including when the configuration asked
for port `0` and the operating system chose. Launching it from a file manager works
the same way, which is the point: there is no terminal there for an address to be
printed to.

No browser is opened where none can be shown — no desktop session, a container, a
remote shell, a CI runner. `--open` and `--no-open` decide it explicitly, and
`"openBrowser": false` in the configuration pins it for a deployment. A browser that
fails to open never stops the server: the address is printed either way.

## Build from source

```bash
npm run build --workspace web       # web UI
npm run build --workspace pi-outpost # produces both .mjs bundles in cli/dist/ (UI inlined)
npm run build:sea --workspace server # .exe + sea-prep.blob in server/dist/ (UI inlined)
```

The `build:sea` step in `server/scripts/build-sea.mjs`:
1. **Builds the web UI** (`npm run build --workspace web`) and **inlines it** into
   `server/src/embedded-web.ts` so the bundle is self-contained.
2. **Bundles** `server/src/index.ts` via esbuild into one ESM file (`bundle.mjs`).
3. **Generates a cross-platform blob** (`sea-prep.blob`) via `--experimental-sea-config`.
4. **On Windows only** (skipped in CI), builds a native `.exe` via `--build-sea`.

## Server-only / embed mode (no inlined UI)

By default the bundle inlines the entire web UI (≈ 185 assets) so the
executable is self-contained. When you only need the **server** — e.g. to embed
the UI as a Shadow-DOM widget in another app, or to serve a `web/` folder you
build/update separately — skip the inlining with `BUILD_EMBED_WEB=0`:

```bash
BUILD_EMBED_WEB=0 npm run build --workspace pi-outpost   # server bundle, no inlined UI
BUILD_EMBED_WEB=0 npm run build:sea --workspace server   # .exe, no inlined UI
```

With `BUILD_EMBED_WEB=0`:

- `server/src/embedded-web.ts` is written **empty** (`EMBEDDED_WEB = {}`), so the
  server falls back to serving the UI from a `web/` folder on disk (the
  `fastifyStatic` path in `server/src/index.ts`).
- The build still copies `web/dist` to `cli/dist/web/`, and the `.exe` looks for
  `./web` next to it. To point at a different location, set
  `PI_OUTPOST_WEB_DIST=/path/to/web/dist` at runtime.
- Updating the UI is then a matter of rebuilding `web/` — no need to recompile
  the server or re-inject the SEA blob.

This is the recommended setup when the executable is a **backend for an embedded
widget** rather than a standalone desktop app.

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

> `pi-outpost build-exe` does this for you, including the `--macho-segment-name
> NODE_SEA` that macOS needs and the ad-hoc signature without which the result is
> killed at launch. Reach for the manual form only when you are debugging the
> command itself.

## Extensions with real npm imports

An extension named in `extensionScripts` lives on disk beside the executable, and
until now it could only import Node built-ins: there are no `node_modules` next to a
single file, so `import { Type } from "typebox"` had nothing to resolve against.

It works now. The packages the agent is built from — `typebox`, `@earendil-works/pi-tui`,
`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai/*` — are served to
extensions from inside the executable:

```ts
// ext.ts, sitting next to pi-outpost, with no node_modules anywhere
import { Type } from "typebox";
import * as agent from "@earendil-works/pi-coding-agent";

export default function extension() {
  const schema = Type.Object({ ok: Type.Boolean() });
  return { name: "my-extension", tools: [] };
}
```

```json
{ "extensionScripts": ["./ext.ts"] }
```

**How.** jiti — the loader the SDK reads extensions through — takes a `virtualModules`
map of specifier to *already-loaded module object*, bypassing filesystem resolution.
The SDK builds that map from static imports and selects it for its Bun binary; a
Node executable is not that, so it fell through to `getAliases()`, whose
`require.resolve` throws inside a blob and took all extension loading with it. Both
build scripts now widen the condition to include a Node single executable. The
objects are already in the bundle; nothing is written to disk, and nothing changes
outside an executable — `npm run dev` and `npm start` resolve packages normally.

You get the same objects the agent itself uses, not a second copy: the versions are
whatever the executable was built with, and an extension cannot pin its own.

## Skills are not inside the executable

The npm package ships the bundled skills under `dist/skills/`, and the server finds
them on the filesystem beside itself. The SEA build inlines the server and the web UI
into one file and **does not embed that directory**, so the standalone executable
starts with no bundled skills.

This degrades rather than breaks. `present_structure` and the rest of the tools work
exactly as they do elsewhere; what is missing is the instructions that tell the agent
what a valid structured-exchange document looks like, so it is more likely to send
one that gets refused and to need a second attempt.

To give the executable its skills, put them somewhere on disk and name that directory
in the config:

```json
{
  "skillPaths": ["./skills"]
}
```

Copy `node_modules/pi-outpost/dist/skills/` next to the executable to get the ones the
package would have provided. A path given this way is loaded even under `noSkills`,
which is deliberate on the SDK's part but worth knowing.

## Extension loading with the SEA build

Both `extensionPaths` and `extensionScripts` load `.ts`/`.mjs` files from the
filesystem through the pi SDK's jiti loader — not through a native `import()`,
which an earlier version of this page claimed and which could never have reached a
file the blob does not contain. jiti reads the file at runtime and, inside an
executable, serves the agent's own packages to it as virtual modules (see
[Extensions with real npm imports](#extensions-with-real-npm-imports)):

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
