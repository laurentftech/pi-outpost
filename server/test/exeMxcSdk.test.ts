/**
 * The standalone executable confines the agent's shell through MXC's SDK, in process
 * (`durable-sandbox-rules`, standalone-executable): MXC's native parts placed beside it by
 * `placeMxcNative`, `"mxc"` as the runner, and a command of the agent's reading beside the root.
 *
 * Only where `PI_OUTPOST_EXE` names an executable built on Windows 11 tier 1
 * (`npm run build:sea --workspace server`, then `server/dist/pi-outpost.exe`): building one takes
 * minutes, and no CI runner has tier 1. `scripts/probes/mxc-sdk-exe.mts` is the same check by hand.
 */
import assert from "node:assert/strict";
import { copyFileSync, existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { placeMxcNative } from "../src/buildExe.ts";
import { MXC_EXECUTOR_NAME } from "../src/mxcExecutor.ts";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const BUILT = process.env.PI_OUTPOST_EXE;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const provider = fileURLToPath(new URL("./fixtures/bash-call-provider.mjs", import.meta.url));
const model = { provider: "bash-call-test", id: "bash-call-test" };
const skip = process.platform !== "win32" ? "MXC runs in process on Windows only here" : !BUILT ? "PI_OUTPOST_EXE (a built pi-outpost.exe) is not set" : false;

describe("the standalone executable under MXC's SDK", { skip }, () => {
  let root: string;
  let beside: string;
  let exe: string;

  before(async () => {
    root = await realpath(await makeWorkspace({ "inside.txt": "inside" }));
    beside = `${root}-beside`;
    await mkdir(beside, { recursive: true });
    await writeFile(path.join(beside, "secret.txt"), "beside-secret");
    // A copy, beside what build-exe places and nothing else: no executor of MXC's.
    const dir = path.join(root, ".exe");
    await mkdir(dir, { recursive: true });
    exe = path.join(dir, "pi-outpost.exe");
    copyFileSync(path.resolve(BUILT!), exe);
    placeMxcNative(exe, { platform: "win32", arch: process.arch, log: () => {} });
  });

  after(async () => {
    if (beside) await rm(beside, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // openlore: scenario=AnExecutableConfinesThroughTheSdk spec=standalone-executable
  test("AnExecutableConfinesThroughTheSdk: a read beside the root is refused by MXC run in process, and no executor of MXC's starts", { timeout: 240_000 }, async () => {
    assert.equal(existsSync(path.join(path.dirname(exe), MXC_EXECUTOR_NAME)), false, "no executor beside the executable");
    const log = path.join(root, "results.json");
    const command = `Get-Content inside.txt; Get-Content '${path.join(beside, "secret.txt").replaceAll("'", "''")}'`;
    const server = await startServer(
      root,
      { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "mxc", bashShell: POWERSHELL }, extensionPaths: [provider], allowedModels: [model] },
      { executable: exe, env: { BASH_CALL_LOG: log, BASH_CALL_STEPS: JSON.stringify([{ tool: "powershell", args: { command } }]) } },
    );
    const client = connect(server.wsUrl());
    try {
      // The self-check runs through the same SDK: wait for its verdict before the command.
      type Verdict = { state: string; runner?: string };
      const bashOf = (m: unknown) => (m as { confinement?: { bash?: Verdict } }).confinement?.bash;
      const hello = await client.waitFor("hello", 30_000);
      const verdict = bashOf(hello)?.state !== "checking" && bashOf(hello) !== undefined ? bashOf(hello)! : bashOf(await client.waitFor((m) => m.type === "confinement" && bashOf(m)?.state !== "checking", 120_000))!;
      assert.equal(verdict.state, "verified", JSON.stringify(verdict));
      assert.equal(verdict.runner, "mxc");
      client.send({ type: "set_model", ...model });
      await client.waitFor("model_changed");
      client.send({ type: "prompt", text: "Go." });
      let output: string | undefined;
      for (let i = 0; i < 1200 && output === undefined; i++) {
        const text = await readFile(log, "utf8").catch(() => undefined);
        if (text) output = (JSON.parse(text) as Array<{ content: Array<{ text?: string }> }>).map((r) => r.content.map((c) => c.text ?? "").join("")).join("\n");
        else await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(output !== undefined, `the agent never finished:\n${server.log()}`);
      assert.match(output, /inside/, "the command ran, confined");
      assert.doesNotMatch(output, /beside-secret/, "the read beside the root is refused");
      assert.match(output, /diagnose: true/, "MXC on Windows: the failure offers a diagnosis");
      assert.doesNotMatch(server.log(), /wxc-exec/i, "no executor of MXC's was started");
      assert.doesNotMatch(server.log(), /MXC's SDK cannot load here/);
    } finally {
      client.close();
      await server.stop();
    }
  });
});
