/**
 * A server on a workspace that is a git repository with one modified file, for driving
 * the editor's git gutter in the running widget. Start `npm run bench` first (it serves
 * the host page on 4321), then:
 *
 *   node --import tsx/esm scripts/probes/git-gutter-server.mts
 *
 * and open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A4330&theme=light.
 * `code.ts` has, against HEAD, line 5 changed, a line added after line 20, and old
 * line 40 removed. Prints the workspace, so it can be changed underneath the app.
 */
import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const PORT = Number(process.env.GUTTER_PORT ?? 4330);
const lines = Array.from({ length: 60 }, (_, index) => `export const line${index + 1} = ${index + 1};`);
const root = await realpath(await makeWorkspace({ "code.ts": `${lines.join("\n")}\n`, "readme.md": "# gutter\n" }));
const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=probe@example.com", "-c", "user.name=probe", ...args], { cwd: root });
git("init", "-q");
git("add", "-A");
git("commit", "-qm", "init");

const edited = (await readFile(path.join(root, "code.ts"), "utf8")).split("\n");
edited[4] = "export const line5 = 500; // changed";
edited.splice(20, 0, "export const added = true;");
edited.splice(40, 1);
await writeFile(path.join(root, "code.ts"), edited.join("\n"));

const env: Record<string, string | undefined> = {};
for (const name of Object.keys(process.env)) if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";

await startServer(
  root,
  {
    server: { allowedOrigins: ["http://127.0.0.1:4321"], port: PORT },
    branding: { title: "git gutter probe" },
    sandbox: { root, allowWrite: true, allowBash: false },
  },
  { env },
);
console.log(`workspace ${root}`);
console.log(`open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A${PORT}&theme=light`);
