/**
 * Probe for issue #426: tool output carrying terminal colour escapes.
 *
 * Starts one more server (port 4330) next to `npm run bench`, whose scripted RPC
 * child replays three tool results as a real pi run would hand them over: a vite
 * build piped through `tail`, a `git diff --color`, and an `rg --color=always`.
 * Open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A4330&theme=light
 * (the bench must be running for the host page on 4321).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- .mjs harness, no types
import { makeWorkspace, startServer } from "../../../server/test/harness.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const E = "\u001b";

const build = [
  "rendering chunks...",
  "computing gzip size...",
  `${E}[2m../${E}[22m${E}[36magent-sources.js   ${E}[39m${E}[1m${E}[2m10.81 kB${E}[22m${E}[1m${E}[22m${E}[2m │ gzip: 4.03 kB${E}[22m`,
  `${E}[32m✓ built in 264ms${E}[39m <b>not markup</b>`,
].join("\n");

const diff = [
  `${E}[1mdiff --git a/src/a.ts b/src/a.ts${E}[m`,
  `${E}[1mindex 111..222 100644${E}[m`,
  `${E}[1m--- a/src/a.ts${E}[m`,
  `${E}[1m+++ b/src/a.ts${E}[m`,
  `${E}[36m@@ -1,2 +1,2 @@${E}[m`,
  " keep",
  `${E}[31m-old${E}[m`,
  `${E}[32m+new${E}[m`,
].join("\n");

const hits = [
  `${E}[35msrc/a.ts${E}[0m:${E}[32m3${E}[0m:const ${E}[1;31mx${E}[0m = 1`,
  `${E}[35msrc/a.ts${E}[0m:${E}[32m7${E}[0m:return ${E}[1;31mx${E}[0m;`,
].join("\n");

const call = (id: string, name: string, args: object) => ({
  role: "assistant",
  content: [{ type: "toolCall", id, name, arguments: args }],
});
const result = (id: string, name: string, text: string) => ({
  role: "toolResult",
  toolCallId: id,
  toolName: name,
  content: [{ type: "text", text }],
});

const messages = [
  { role: "user", content: "Build it, show the diff, find x." },
  call("b1", "bash", { command: "npm run build 2>&1 | tail -4" }),
  result("b1", "bash", build),
  call("b2", "bash", { command: "git diff --color" }),
  result("b2", "bash", diff),
  call("b3", "grep", { pattern: "x" }),
  result("b3", "grep", hits),
  { role: "assistant", content: [{ type: "text", text: "Done." }] },
];

const root = await makeWorkspace({ "readme.md": "# ansi\n" });
const config = path.join(root, "fake-rpc.json");
await writeFile(config, JSON.stringify({ messages, state: { sessionId: "ansi-1" } }));
const env: Record<string, string | undefined> = {};
for (const name of Object.keys(process.env)) {
  if (name.includes("API_KEY") || name.includes("AUTH_TOKEN") || name.endsWith("_TOKEN")) env[name] = undefined;
}
env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
env.FAKE_PI_RPC_CONFIG = config;
const server = await startServer(
  root,
  {
    server: { allowedOrigins: ["http://127.0.0.1:4321"], port: 4330 },
    branding: { title: "ansi probe", defaultTheme: "light" },
    agentRuntime: {
      mode: "rpc",
      executable: process.execPath,
      args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")],
      startupTimeoutMs: 20_000,
    },
    sandbox: undefined,
  },
  { env },
);
console.log(`ansi probe on ${server.base}`);
await new Promise(() => {});
