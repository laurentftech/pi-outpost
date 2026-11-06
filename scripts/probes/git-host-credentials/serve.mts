/**
 * Probe for git-host-credentials (#425): a private Git host and a pi-outpost server
 * that has no credential for it.
 *
 * Starts a Git smart-HTTPS server behind Basic auth (user `alice`, password `right`)
 * serving `demo.git` with one skill, and a pi-outpost server on port 4331 whose git
 * trusts that server's test certificate and nothing of the developer's own git setup.
 * Run next to `npm run bench` (its host page on 4321), then open
 * http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A4331&theme=light
 * and add the printed address from Settings → Agent resources → Add Git repository.
 *
 * `PROBE_LOCKED=1` starts the server with `credentialsLock: true`.
 */
import { mkdtempSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error -- .mjs fixture, no types
import { gitTrustEnv, makeBareRepository, startGitHttpServer } from "../../../server/test/fixtures/gitHttpServer.mjs";
// @ts-expect-error -- .mjs harness, no types
import { makeWorkspace, startServer } from "../../../server/test/harness.mjs";

const gitRoot = mkdtempSync(path.join(tmpdir(), "pi-outpost-probe-git-"));
makeBareRepository(gitRoot, "demo");
const git = await startGitHttpServer({ root: gitRoot, credentials: { username: "alice", password: "right" } });

const root = await makeWorkspace({ "readme.md": "# git host credentials probe\n" });
const env: Record<string, string | undefined> = {};
for (const name of Object.keys(process.env)) {
  if (name.includes("API_KEY") || name.includes("AUTH_TOKEN") || name.endsWith("_TOKEN")) env[name] = undefined;
}
env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
Object.assign(env, { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1", ...gitTrustEnv() });
const server = await startServer(
  root,
  {
    server: { allowedOrigins: ["http://127.0.0.1:4321"], port: 4331 },
    branding: { title: "git credentials probe", defaultTheme: "light" },
    ...(process.env.PROBE_LOCKED ? { credentialsLock: true } : {}),
  },
  { env },
);
console.log(`pi-outpost   ${server.base}  (workspace ${root}, agent dir ${path.join(root, ".pi-agent")})`);
console.log(`git address  ${git.base}/demo.git   user alice / password right`);
console.log(`clone parent ${root}`);
await new Promise(() => {});
