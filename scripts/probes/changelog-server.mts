/**
 * A bundled server that has just been "updated": built like the npm package, with this
 * repository's CHANGELOG.md inlined and a version of 0.44.0, started against an agent
 * directory whose marker says 0.43.0 ran before. Start `npm run bench` first (it serves
 * the host page on 4321), then:
 *
 *   node --import tsx/esm scripts/probes/changelog-server.mts
 *
 * and open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A4332&theme=light.
 * Prints the agent directory, so the marker can be changed underneath the app.
 */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const PORT = Number(process.env.CHANGELOG_PORT ?? 4332);
const VERSION = process.env.CHANGELOG_VERSION ?? "0.44.0";
const repo = fileURLToPath(new URL("../..", import.meta.url));
// Inside the repo, so the externals resolve from node_modules
const cache = path.join(repo, "node_modules/.cache");
await mkdir(cache, { recursive: true });
const outfile = path.join(await mkdtemp(path.join(cache, "changelog-probe-")), "pi-outpost.mjs");
await esbuild.build({
  entryPoints: [path.join(repo, "server/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  external: ["@earendil-works/pi-coding-agent", "@fastify/static", "@fastify/websocket", "fastify", "node-pty", "ws"],
  define: {
    __PI_OUTPOST_VERSION__: JSON.stringify(VERSION),
    __PI_OUTPOST_CHANGELOG__: JSON.stringify(await readFile(path.join(repo, "CHANGELOG.md"), "utf8")),
  },
  banner: { js: "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);" },
  logLevel: "error",
});

const agentDir = await mkdtemp(path.join(tmpdir(), "pi-outpost-changelog-agent-"));
await writeFile(path.join(agentDir, "outpost-version.json"), JSON.stringify({ version: process.env.CHANGELOG_FROM ?? "0.43.0" }));

const env: Record<string, string | undefined> = {};
for (const name of Object.keys(process.env)) if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";

await startServer(
  await makeWorkspace({ "readme.md": "# changelog probe\n" }),
  {
    server: { allowedOrigins: ["http://127.0.0.1:4321"], port: PORT },
    branding: { title: "changelog probe" },
    agentDir,
    updateCheck: false,
  },
  { env, entry: outfile },
);
console.log(`agentDir ${agentDir}`);
console.log(`open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A${PORT}&theme=light`);
