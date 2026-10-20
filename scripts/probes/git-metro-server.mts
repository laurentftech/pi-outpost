/**
 * A server on a workspace whose git history has branches and merges, for driving the
 * branch chip's metro map in the running widget. Start `npm run bench` first (it serves
 * the host page on 4321), then:
 *
 *   node --import tsx/esm scripts/probes/git-metro-server.mts
 *
 * and open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A4331&theme=light.
 * `main` carries a merged `feature`; `topic` and `long-branch-name-for-truncation` are
 * unmerged, `topic` newer than HEAD; the merge is tagged `v1.0.0` (annotated), HEAD
 * `nightly`. Prints the workspace, so it can be changed
 * underneath the app.
 */
import { execFileSync } from "node:child_process";
import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const PORT = Number(process.env.METRO_PORT ?? 4331);
const root = await realpath(await makeWorkspace({ "readme.md": "# metro\n" }));
let minute = 0;
const git = (...args: string[]) => {
  const date = `2026-01-01T00:${String(minute).padStart(2, "0")}:00Z`;
  return execFileSync("git", ["-c", "user.email=probe@example.com", "-c", "user.name=probe", ...args], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
};
const commit = async (file: string, subject: string) => {
  minute++;
  await writeFile(path.join(root, file), `${subject}\n`);
  git("add", "-A");
  git("commit", "-qm", subject);
};

git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-qm", "init");
await commit("a.txt", "main: first change");
git("checkout", "-q", "-b", "feature");
await commit("f.txt", "feature: start");
await commit("f.txt", "feature: finish");
git("checkout", "-q", "main");
await commit("a.txt", "main: meanwhile");
minute++;
git("merge", "-q", "--no-ff", "feature", "-m", "Merge branch 'feature'");
git("tag", "-a", "v1.0.0", "-m", "first release");
git("checkout", "-q", "-b", "long-branch-name-for-truncation");
await commit("l.txt", "long: a side line");
git("checkout", "-q", "main");
await commit("a.txt", "main: after the merge");
git("tag", "nightly");
git("checkout", "-q", "-b", "topic", "HEAD~1");
await commit("t.txt", "topic: newer than HEAD");
git("checkout", "-q", "main");

const env: Record<string, string | undefined> = {};
for (const name of Object.keys(process.env)) if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";

await startServer(
  root,
  {
    server: { allowedOrigins: ["http://127.0.0.1:4321"], port: PORT },
    branding: { title: "git metro probe" },
    sandbox: { root, allowWrite: true, allowBash: false },
  },
  { env },
);
console.log(`workspace ${root}`);
console.log(`open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A${PORT}&theme=light`);
