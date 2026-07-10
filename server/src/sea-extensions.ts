import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * Extensions to bake into a SEA (Single Executable Application) build — see
 * server/scripts/build-sea.mjs and docs/sea-packaging.md.
 *
 * config.extensionPaths (pi-interface.config.json) loads extensions dynamically
 * at runtime via the SDK's jiti-based loader, which does not survive being bundled
 * into a single file (confirmed: silently registers zero commands, no error).
 * extensionFactories sidesteps that entirely — the SDK just calls the function
 * directly, no dynamic loading involved — but each one has to be a real static
 * import here, since esbuild needs a literal path to bundle it.
 *
 * Empty by default: has no effect on the normal `npm run dev` / `npm run start`
 * flow, which still uses config.extensionPaths as usual.
 */
export const seaExtensionFactories: ExtensionFactory[] = [
  // import myExtension from "../extensions/my-extension.ts";
  // myExtension,
];
