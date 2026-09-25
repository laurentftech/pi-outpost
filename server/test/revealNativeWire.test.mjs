/**
 * reveal_native over a real server and a real WebSocket.
 *
 * The file manager is replaced at the one place the server looks for it — PATH — by a
 * script that records what it was asked, so the server's own spawn is what runs, and no
 * window opens on the machine running the tests.
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

test("RevealIsAcknowledgedOrRefusedUnderItsRequestId", async (t) => {
  const root = await makeWorkspace({ "docs/report.docx": "x" });
  const bin = await mkdtemp(path.join(tmpdir(), "pi-reveal-bin-"));
  const log = path.join(bin, "calls.log");
  // Windows has no script to put first on PATH for explorer.exe; there, only the refusal is exercised.
  const recorded = process.platform !== "win32";
  if (recorded) {
    for (const name of ["dbus-send", "open"]) {
      const script = path.join(bin, name);
      await writeFile(script, `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
      await chmod(script, 0o755);
    }
  }
  // Only where the scripts are used: on Windows the variable is `Path`, and a second one would confuse the child.
  const server = await startServer(root, {}, recorded ? { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } } : {});
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);

  client.send({ type: "reveal_native", path: "docs/missing.docx", requestId: "fileop:missing" });
  const refused = await client.waitFor((m) => m.type === "file_browser_error" && m.requestId === "fileop:missing");
  assert.equal(refused.reason, "not-found");

  client.send({ type: "reveal_native", path: "../outside", requestId: "fileop:outside" });
  const outside = await client.waitFor((m) => m.type === "file_browser_error" && m.requestId === "fileop:outside");
  assert.equal(outside.reason, "outside-root");

  if (!recorded) return;
  client.send({ type: "reveal_native", path: "docs/report.docx", requestId: "fileop:ok" });
  const done = await client.waitFor((m) => m.type === "file_operation_result" && m.requestId === "fileop:ok");
  assert.deepEqual({ operation: done.operation, path: done.path }, { operation: "reveal_native", path: "docs/report.docx" });
  const calls = (await readFile(log, "utf8")).trim().split("\n");
  assert.equal(calls.length, 1, "one launcher call, and none for the refused requests");
  if (process.platform === "darwin") assert.match(calls[0], /^open -R .*report\.docx$/);
  else assert.match(calls[0], /^dbus-send .*org\.freedesktop\.FileManager1\.ShowItems array:string:file:\/\/.*docs\/report\.docx string:$/);
});
