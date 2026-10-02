/**
 * Preload that makes `node-pty` unresolvable, reproducing an install where the optional
 * native dependency did not build — Linux or WSL without a toolchain, or npm 12 skipping
 * its install script.
 *
 * The server imports it with ESM `import()`, which `Module._resolveFilename` (the trick
 * `no-native-canvas.cjs` uses) does not see, so this is a module resolve hook.
 *
 *   NODE_OPTIONS="--import <file URL of this module>"
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node-pty" || specifier.startsWith("node-pty/")) {
      const error = new Error(`Cannot find module '${specifier}'`);
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    }
    return nextResolve(specifier, context);
  },
});
