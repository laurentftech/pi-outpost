/**
 * `npm run dev`'s restart-on-change, without `node --watch`.
 *
 * On Windows, `node --watch` (and `tsx watch`) restart on any change a directory watch
 * reports, and NTFS reports a file's last-access time changing as one. Where last-access
 * updates are on — Windows' "system managed" default on many machines — merely *reading*
 * a source file not read for an hour restarts the server: a lazy import, git, an editor,
 * the antivirus or the search indexer will do. Each restart reads dozens of modules, and
 * the restarts cascade (23 in ten minutes, measured, with nothing edited).
 *
 * So this restarts only when a file's content may have changed: its modification time or
 * its size differs from what was last seen, or it appeared or went away. It watches the
 * source trees the server runs from — its own, and the workspace packages it imports as
 * source — rather than every module loaded; a change under `node_modules` (an install)
 * needs a manual restart, as it should.
 *
 * Usage: node scripts/dev-watch.mjs -- <node arguments…>
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TREES = ["src", "../shared/src", "../office/src", "../posters/src"].map((tree) => path.resolve(SERVER, tree));
const SOURCE = /\.(?:[cm]?[jt]sx?|json)$/;
/** Edits arrive as bursts of events (an editor's save, a branch switch): one restart for a burst. */
const SETTLE_MS = 200;

const separator = process.argv.indexOf("--");
const nodeArgs = separator === -1 ? [] : process.argv.slice(separator + 1);
if (nodeArgs.length === 0) {
  console.error("usage: node scripts/dev-watch.mjs -- <node arguments…>");
  process.exit(2);
}

/** What a file looked like when last seen: enough to tell a write from a read. */
function signature(file) {
  try {
    const stats = statSync(file);
    return stats.isFile() ? `${stats.mtimeMs}:${stats.size}` : undefined;
  } catch {
    return undefined;
  }
}

/** @type {Map<string, string>} */
const seen = new Map();
function record(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") record(full);
    } else if (SOURCE.test(entry.name)) {
      const now = signature(full);
      if (now !== undefined) seen.set(full, now);
    }
  }
}
for (const tree of TREES) record(tree);

/** True when `file` was written, created or removed since it was last seen. */
function changed(file) {
  const before = seen.get(file);
  const now = signature(file);
  if (now === undefined) seen.delete(file);
  else seen.set(file, now);
  return before !== now;
}

let child;
let restarting = false;
function start() {
  child = spawn(process.execPath, nodeArgs, { cwd: SERVER, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (restarting) return;
    console.log(`[dev-watch] the server exited (${signal ?? `code ${code}`}); waiting for a change`);
  });
}

function restart(because) {
  console.log(`[dev-watch] ${path.relative(SERVER, because)} changed — restarting`);
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return start();
  restarting = true;
  child.once("exit", () => {
    restarting = false;
    start();
  });
  child.kill();
}

let pending;
let first;
for (const tree of TREES) {
  try {
    watch(tree, { recursive: true }, (_event, name) => {
      if (name === null || !SOURCE.test(name) || name.split(/[\\/]/).includes("node_modules")) return;
      const file = path.join(tree, name);
      // A read changes the access time and nothing this compares: no restart.
      if (!changed(file)) return;
      first ??= file;
      clearTimeout(pending);
      pending = setTimeout(() => {
        const because = first;
        first = undefined;
        restart(because);
      }, SETTLE_MS);
    });
  } catch (error) {
    // A package not checked out here, or a platform without recursive watching.
    if (error.code !== "ENOENT") console.warn(`[dev-watch] not watching ${tree}: ${error.message}`);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restarting = true;
    if (child && child.exitCode === null) child.once("exit", () => process.exit(0)).kill();
    else process.exit(0);
  });
}

start();
