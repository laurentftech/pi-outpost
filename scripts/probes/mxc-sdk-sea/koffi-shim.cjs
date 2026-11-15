// koffi, from beside the executable: a SEA's own require loads built-ins only.
const { createRequire } = require("node:module");
const path = require("node:path");
module.exports = createRequire(path.join(path.dirname(process.execPath), "koffi-host.cjs"))("koffi");
