import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * Extensions to bake into a SEA (Single Executable Application) build — see
 * server/scripts/build-sea.mjs and docs/sea-packaging.md.
 *
 * Runtime-loaded extensions use config.extensionScripts (native import()).
 * This file is only needed for extensions that must be baked into the bundle
 * itself (no external file on disk at runtime). Each entry must be a real
 * static import since esbuild needs a literal path to bundle it.
 *
 * Empty by default: has no effect on the normal `npm run dev` / `npm run start`
 * flow, which reads config.extensionScripts as usual.
 */
import monExt from "../../interactive-test/mon-ext/index.ts";

export const seaExtensionFactories: ExtensionFactory[] = [
  monExt as unknown as ExtensionFactory,
];
