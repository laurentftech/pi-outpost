// Preloaded into the test server (NODE_OPTIONS) so that node, playing a sandbox runner,
// answers its self-check: `node doctor` from whatever directory the server runs in.
// Every other node process the server starts is left alone.
const path = require("node:path");
if (process.argv[1] && path.basename(process.argv[1]) === "doctor") {
  process.stdout.write(JSON.stringify({ ok: true }) + "\n");
  process.exit(0);
}
