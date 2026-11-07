#!/usr/bin/env node
/**
 * What a second project actually costs.
 *
 * The design spikes measured a bare pi session — no extensions, no skills, no
 * sandboxed toolset, no file watcher. That is the cheap half of a workspace, and
 * quoting it would understate what opening a project on a real server does. This
 * opens projects one at a time against a running server, with everything a real
 * workspace carries, and reads the server process's own RSS between each.
 *
 * Run: node scripts/measure-workspace-cost.mjs [projectCount]
 * It prints one line per project and a summary; nothing here is asserted, because
 * memory is a measurement and not a contract.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";

const COUNT = Number(process.argv[2] ?? 3);

/** Resident set of a pid, in MB. `ps` is the one reading that costs nothing to take. */
function rssMb(pid) {
  const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim();
  return Number(out) / 1024;
}

/** The server's own pid, found by the port it is listening on. */
function serverPid(port) {
  const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  return Number(out.split("\n")[0]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A project with the things a real one has: a skill, an extension, files to watch. */
async function project(name) {
  return makeWorkspace({
    "README.md": `# ${name}\n`,
    "src/index.ts": "export const answer = 42;\n",
    "src/util.ts": "export const double = (n: number) => n * 2;\n",
    [`${name}-skill/SKILL.md`]: `---\nname: ${name}-skill\ndescription: A real skill\n---\n\nDo the thing.\n`,
    "ext.ts": "export default function () {}\n",
  });
}

const roots = [];
for (let i = 0; i < COUNT + 1; i += 1) roots.push(await project(`p${i}`));
const [first, ...rest] = roots;

const server = await startServer(first, {
  // Everything a workspace really carries: its own sandboxed toolset, its own
  // watcher, skills and an extension loaded per session.
  sandbox: { root: first, allowWrite: true, writableRoot: first, allowBash: false },
  noSkills: false,
  skillPaths: [path.join(first, "p0-skill")],
  extensionPaths: [path.join(first, "ext.ts")],
  files: { watch: true },
});

try {
  const pid = serverPid(server.port);
  const client = connect(server.wsUrl());
  await client.waitFor((m) => m.type === "hello");

  const baseline = rssMb(pid);
  console.log(`pid ${pid} · one project open · ${baseline.toFixed(1)} MB`);

  const readings = [];
  for (const [index, root] of rest.entries()) {
    const before = rssMb(pid);
    const started = Date.now();
    client.send({ type: "open_project", root });
    await client.waitFor((m) => m.type === "workspace_switched" && m.workspace?.root.endsWith(path.basename(root)));
    const elapsed = Date.now() - started;
    // Settle: the session finishes its own startup work after the snapshot.
    await sleep(1_000);
    const after = rssMb(pid);
    readings.push({ delta: after - before, elapsed });
    console.log(`+ project ${index + 2}: ${after.toFixed(1)} MB (+${(after - before).toFixed(1)} MB) · opened in ${elapsed} ms`);
  }

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const final = rssMb(pid);
  // Per-step deltas are noisy — a collection between two readings can swallow a
  // project whole, or hand back more than one cost. Growth from the baseline over
  // the whole run is the number to quote; the steps are there to show the spread.
  console.log(`\ngrowth from one project to ${roots.length}: ${(final - baseline).toFixed(1)} MB`);
  console.log(
    `per additional project: ${((final - baseline) / readings.length).toFixed(1)} MB, ${Math.round(mean(readings.map((r) => r.elapsed)))} ms to open`,
  );
  console.log(`total RSS: ${final.toFixed(1)} MB (RSS moves with GC — repeat the run before trusting a single figure)`);
  client.close();
} finally {
  await server.stop();
}
