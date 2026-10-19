/**
 * A server whose header is crowded the way a real one gets: a project, a long branch,
 * and an extension setting several statuses. For checking that the header's controls
 * keep one height and that the statuses fold when they do not fit.
 *
 *   node --import tsx/esm scripts/probes/header-statuses-server.mts
 *
 * then open the printed address, send `/statuses`, and narrow the window. `/longer` replaces one status
 * with a long one, `/fewer` leaves a single short one, to watch the fold follow.
 */
import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const PORT = Number(process.env.HEADER_PORT ?? 4331);
const root = await realpath(await makeWorkspace({ "readme.md": "# header\n" }));
execFileSync("git", ["init", "-q", "-b", "feat/git-gutter-and-a-longer-branch-name", root]);
execFileSync("git", ["-c", "user.email=p@example.com", "-c", "user.name=p", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: root });

const extension = path.join(root, ".probe-extension");
await mkdir(extension);
await writeFile(
  path.join(extension, "index.ts"),
  `export default (pi) => {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("openlore", "openlore: daemon unavailable");
    ctx.ui.setStatus("router", "OmniRoute ×");
    ctx.ui.setStatus("agent", "@build");
  });
  // A client that connects later is not told statuses set before it came, so these are
  // also set on demand, once the page is open.
  pi.registerCommand("statuses", { description: "set the three statuses", handler: async (_args, ctx) => {
    ctx.ui.setStatus("openlore", "openlore: daemon unavailable");
    ctx.ui.setStatus("router", "OmniRoute ×");
    ctx.ui.setStatus("agent", "@build");
  } });
  pi.registerCommand("longer", { description: "make one status long", handler: async (_args, ctx) => {
    ctx.ui.setStatus("router", "OmniRoute: falling back to the secondary provider after three timeouts");
  } });
  pi.registerCommand("fewer", { description: "leave one short status", handler: async (_args, ctx) => {
    ctx.ui.setStatus("openlore", undefined);
    ctx.ui.setStatus("router", undefined);
  } });
};
`,
);

const env: Record<string, string | undefined> = {};
for (const name of Object.keys(process.env)) if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";

await startServer(root, { server: { port: PORT }, branding: { title: "π dev" }, extensionPaths: [extension] }, { env });
console.log(`open http://127.0.0.1:${PORT}/`);
