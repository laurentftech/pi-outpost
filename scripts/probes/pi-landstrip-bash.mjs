/**
 * Does the agent's `bash` run through pi-landstrip (`sandbox.bashFrom`)?
 *
 * Starts a real pi-outpost server through the test harness with pi-landstrip loaded and
 * named as bash's source, has a scripted provider make the agent call `bash` once
 * (`echo from-the-shell`), and writes what happened to ~/pls-summary.json: the tool
 * result the model got, or — when none came — every message the client saw, so a
 * permission dialog left unanswered is visible.
 *
 * Written for Windows (it reproduces "bash seems stuck" there) but runs anywhere.
 *
 *   cd server && node ../scripts/probes/pi-landstrip-bash.mjs <default|policy>
 *
 * PLS_DIR: the directory, under the home directory, where pi-landstrip is installed
 * (`npm install pi-landstrip@<version>` there). Default "pls".
 * Variant "policy" writes pi-landstrip's sandbox.json allowing the system and Git for
 * Windows, which "default" leaves to its bundled policy.
 */
import { readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, makeWorkspace, startServer } from "../../server/test/harness.mjs";

const PLS = path.join(os.homedir(), process.env.PLS_DIR ?? "pls", "node_modules", "pi-landstrip", "dist", "index.ts");
const PROVIDER = path.resolve(import.meta.dirname, "../../server/test/fixtures/bash-call-provider.mjs");
const MODEL = { provider: "bash-call-test", id: "bash-call-test" };
const SUMMARY = path.join(os.homedir(), "pls-summary.json");
const variant = process.argv[2] ?? "default";

const project = await realpath(await makeWorkspace({ "readme.txt": "mine" }));
const log = path.join(project, "bash-result.json");
if (variant === "policy") {
  await mkdir(path.join(project, ".pi-agent"), { recursive: true });
  await writeFile(
    path.join(project, ".pi-agent", "sandbox.json"),
    JSON.stringify({ shell: { readAccess: "policy" }, filesystem: { allowRead: [".", process.env.SystemRoot ?? "/usr", "C:/Program Files/Git"] } }),
  );
}

const t0 = Date.now();
const server = await startServer(
  project,
  {
    sandbox: { root: project, allowWrite: true, writableRoot: project, allowBash: true, bashFrom: PLS },
    extensionPaths: [PLS, PROVIDER],
    allowedModels: [MODEL],
  },
  { env: { BASH_CALL_LOG: log } },
);
const startedMs = Date.now() - t0;
const client = connect(server.wsUrl());
const summary = () =>
  client.received
    .filter((m) => !/^(message_update|tool_update|workspace_activity|structured_appearance)$/.test(m.type))
    .map((m) =>
      m.type === "extension_ui_request"
        ? `UI(${m.method}): ${(m.title ?? "") + " " + (m.message ?? "")}`.slice(0, 300)
        : m.type === "tool_start"
          ? `tool_start:${m.toolName ?? m.name}`
          : m.type,
    );
// Written to a file, not printed: on Windows a console write to a pipe is lost on exit.
const finish = async (data) => {
  writeFileSync(SUMMARY, JSON.stringify({ variant, pls: PLS, startedMs, ...data, received: summary() }, null, 1));
  client.close();
  await server.stop();
  process.exit(0);
};
setTimeout(() => finish({ timeout: true }), 150_000).unref();

await client.waitFor("hello", 60_000);
client.send({ type: "set_model", ...MODEL });
await client.waitFor("model_changed", 30_000);
client.send({ type: "prompt", text: "Run the shell." });
for (let i = 0; i < 400; i++) {
  const value = await readFile(log, "utf8").catch(() => undefined);
  if (value !== undefined) await finish({ result: value });
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await finish({ noResult: true });
