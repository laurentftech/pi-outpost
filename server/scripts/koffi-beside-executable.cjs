// koffi, for the standalone executable's bundle (server/scripts/build-sea.mjs aliases `koffi` here).
//
// MXC's SDK loads its native library through koffi, a native addon a bundle cannot hold. Where it
// is installed (a clone, a test of the bundle) the ordinary require finds it. Inside a single
// executable, whose own require loads built-ins only, it is loaded from beside the executable,
// where `build-exe` placed it with its platform package (server/src/buildExe.ts, placeMxcNative).
const { createRequire } = require("node:module");
const path = require("node:path");

// The name is built, not written: written, the bundler would alias it back to this very module,
// whose exports are still empty while it loads, and every koffi call would fail.
const KOFFI = ["kof", "fi"].join("");

function load() {
  try {
    return require(KOFFI);
  } catch {
    return createRequire(path.join(path.dirname(process.execPath), "koffi-host.cjs"))(KOFFI);
  }
}

module.exports = load();
