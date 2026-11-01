/**
 * Grants under the real runners: a directory beside the root, granted read-write or read only,
 * reached by the one command it was granted to, and refused to the next one.
 *
 * One check for every runner, each where its environment names it: MXC on Windows (`MXC_EXEC`,
 * Windows PowerShell), MXC on Linux (`MXC_LXC_EXEC` with `MXC_LINUX_EXPECT=confined`, CI's
 * `mxc-linux` job), MXC on macOS (`MXC_MAC_EXEC`) and Seatbelt (`SEATBELT_EXEC`, CI's
 * `mxc-macos` job), and landstrip (`LANDSTRIP_BIN`, CI's Linux job). Judged on the host: a file
 * written, or not, beside the root — Bubblewrap may accept a write in its private tmpfs.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations, type ConfinedBashOperations } from "../src/confinedBash.ts";
import type { Grant } from "../src/sandboxGrants.ts";
import { startEgressProxy, type EgressProxy } from "../src/egressProxy.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const RUNNERS: Array<{ name: string; runner: string | undefined; skip: string | false; shell?: string }> = [
  { name: "MXC on Windows", runner: process.env.MXC_EXEC, shell: POWERSHELL, skip: process.platform !== "win32" ? "Windows only" : !process.env.MXC_EXEC && "MXC_EXEC is not set" },
  {
    name: "MXC on Linux",
    runner: process.env.MXC_LXC_EXEC,
    skip: process.platform !== "linux" ? "Linux only" : (!process.env.MXC_LXC_EXEC || process.env.MXC_LINUX_EXPECT !== "confined") && "MXC_LXC_EXEC with MXC_LINUX_EXPECT=confined is not set",
  },
  { name: "MXC on macOS", runner: process.env.MXC_MAC_EXEC, skip: process.platform !== "darwin" ? "macOS only" : !process.env.MXC_MAC_EXEC && "MXC_MAC_EXEC is not set" },
  { name: "Seatbelt", runner: process.env.SEATBELT_EXEC, skip: process.platform !== "darwin" ? "macOS only" : !process.env.SEATBELT_EXEC && "SEATBELT_EXEC is not set" },
  { name: "landstrip", runner: process.env.LANDSTRIP_BIN, skip: process.platform !== "linux" ? "Linux only" : !process.env.LANDSTRIP_BIN && "LANDSTRIP_BIN is not set" },
];

// What `hostGrantsRefusal` waits for on the POSIX runners holding the network (MXC on Windows is
// `confinedNetworkMxc.test.ts`): a command reaches its own proxy, and no other session's.
for (const { name, runner, skip } of RUNNERS.filter((entry) => ["MXC on Linux", "MXC on macOS", "Seatbelt"].includes(entry.name))) {
  describe(`another session's proxy under ${name}`, { skip }, () => {
    let base: string;
    let root: string;
    let own: EgressProxy;
    let other: EgressProxy;

    before(async () => {
      base = await mkdtemp(path.join(tmpdir(), "grants-proxy-"));
      root = path.join(base, "app");
      await mkdir(root);
      own = await startEgressProxy({ allowedHosts: [], onRefused: () => {} });
      other = await startEgressProxy({ allowedHosts: ["example.invalid"], onRefused: () => {} });
    });
    after(async () => {
      await own?.close();
      await other?.close();
      if (base) await rm(base, { recursive: true, force: true });
    });

    test("a command reaches its own proxy, and the port of another is closed to it", async () => {
      const ops = confinedBashOperations({ runner: runner!, root, allowWrite: true, agentDir: path.join(base, "agent"), networkProxy: own, allowedHosts: [] });
      let output = "";
      const port = new URL(other.url).port;
      await ops.exec(
        [
          `echo "own=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://example.invalid/)"`,
          `echo "other=$(curl -s -o /dev/null -m 10 -x http://127.0.0.1:${port} -w '%{http_code}' http://example.invalid/)"`,
        ].join("\n"),
        root,
        { onData: (data) => (output += data.toString()) },
      );
      // Its own proxy answers, refusing the unlisted host: the command does reach a proxy.
      assert.match(output, /own=403/, output);
      // Another proxy would answer too — 200 for its listed host, 403 otherwise. No answer: unreachable.
      assert.match(output, /other=000/, `a command reached another session's proxy: ${output}`);
    });
  });
}

for (const { name, runner, shell, skip } of RUNNERS) {
  // openlore: scenario=ADirectoryBesideTheRootIsWritableUnderEachRunner spec=sandbox-approved-grants
  // openlore: scenario=AReadGrantDoesNotWrite spec=sandbox-approved-grants
  describe(`grants under ${name}`, { skip }, () => {
    let base: string;
    let root: string;
    let writable: string;
    let readable: string;
    let ops: ConfinedBashOperations;
    const powerShell = shell === POWERSHELL;

    before(async () => {
      const check = await checkRunner(runner!);
      assert.ok(check.ok, `${name} cannot confine here: ${check.ok ? "" : check.reason}`);
      base = await mkdtemp(path.join(tmpdir(), "grants-real-"));
      root = path.join(base, "app");
      writable = path.join(base, "beside");
      readable = path.join(base, "notes");
      for (const dir of [root, writable, readable]) await mkdir(dir);
      await writeFile(path.join(writable, "marker"), "beside-marker");
      await writeFile(path.join(readable, "marker"), "notes-marker");
      ops = confinedBashOperations({ runner: runner!, ...(shell ? { shell } : {}), root, allowWrite: true, agentDir: path.join(base, "agent") });
    });
    after(async () => {
      if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    /** Read both markers, then write one file in each directory. */
    const attempt = (tag: string) =>
      powerShell
        ? [
            ...[writable, readable].map((dir) => `try { Get-Content -Raw '${path.join(dir, "marker")}' } catch { 'read refused' }`),
            ...[writable, readable].map((dir) => `try { Set-Content -Path '${path.join(dir, `${tag}.txt`)}' -Value x -ErrorAction Stop } catch { 'write refused' }`),
          ].join("\n")
        : [
            ...[writable, readable].map((dir) => `cat '${path.join(dir, "marker")}' || echo 'read refused'`),
            ...[writable, readable].map((dir) => `echo x > '${path.join(dir, `${tag}.txt`)}' || echo 'write refused'`),
          ].join("\n");

    async function run(command: string, grant?: Grant) {
      let output = "";
      const onData = (data: Buffer) => (output += data.toString());
      await (grant ? ops.execWithGrant(command, root, { onData }, grant) : ops.exec(command, root, { onData }));
      return output;
    }

    test("the granted command reads both, writes where it may only", async () => {
      const output = await run(attempt("granted"), { hosts: [], directories: [{ path: writable, access: "write" }, { path: readable, access: "read" }] });
      assert.match(output, /beside-marker/, output);
      assert.match(output, /notes-marker/, output);
      assert.equal(await readFile(path.join(writable, "granted.txt"), "utf8").then((text) => text.trim()), "x", "the write grant did not write");
      assert.equal(existsSync(path.join(readable, "granted.txt")), false, "a read grant wrote");
    });

    test("the next command, without the grant, reaches neither", async () => {
      const output = await run(attempt("after"));
      assert.doesNotMatch(output, /beside-marker|notes-marker/, output);
      assert.equal(existsSync(path.join(writable, "after.txt")), false, "a write landed beside the root without a grant");
      assert.equal(existsSync(path.join(readable, "after.txt")), false, "a write landed beside the root without a grant");
    });
  });
}
