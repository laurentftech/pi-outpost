#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const names = readdirSync(path.join(serverRoot, "test"));
// Match both globs from the previous command, including their ordering.
const files = ["mjs", "ts"].flatMap(extension => names
  .filter(name => name.endsWith(`.test.${extension}`))
  .sort()
  .map(name => path.join("test", name)));
if (files.length === 0) throw new Error("No server test files found.");

// node-pty's Windows console-list helper races console teardown. Running real
// terminal files alongside other test processes can abort a test worker, even
// after its assertions passed: https://github.com/microsoft/node-pty/issues/1007
// Keep the normal batch parallel, then run every terminal file without other
// test workers. The concurrent-open scenarios inside those files still run.
const isTerminal = file => path.basename(file).startsWith("terminal");
const batches = process.platform === "win32"
  ? [
      { label: "server", files: files.filter(file => !isTerminal(file)), options: [] },
      { label: "Windows terminals", files: files.filter(isTerminal), options: ["--test-concurrency=1"] },
    ]
  : [{ label: "server", files, options: [] }];

for (const batch of batches) {
  if (batch.files.length === 0) continue;
  console.log(`[server tests] ${batch.label}: ${batch.files.length} files`);
  const result = spawnSync(process.execPath, [
    "--import", "tsx/esm", "--test", "--test-timeout=300000",
    ...process.argv.slice(2), ...batch.options, ...batch.files,
  ], { cwd: serverRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  // Still run the terminal batch after a failed normal batch, and retain any failure.
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
