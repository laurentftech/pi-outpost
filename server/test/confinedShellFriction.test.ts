/**
 * What a confined command met that a model does not expect (issue #547): PowerShell's startup line
 * about a drive the sandbox does not reach, background processes ended with their command, no WMI
 * under MXC on Windows, and SQLite's WAL databases under a read-only grant.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { confinedBashOperations, sqliteReadOnlyNote, withoutPowerShellDriveNoise } from "../src/confinedBash.ts";
import { createSandboxedTools } from "../src/sandbox.ts";

/** The line as PowerShell 5.1 wrote it on a French machine with a mapped network drive: code page 437. */
const NOISE = Buffer.from("La tentative d'ex\x82cution de l'op\x82ration InitializeDefaultDrives sur le fournisseur \xae FileSystem \xaf a \x82chou\x82.\r\n", "latin1");

const collect = () => {
  const parts: Buffer[] = [];
  return { next: (data: Buffer) => parts.push(data), text: () => Buffer.concat(parts).toString("latin1") };
};

describe("PowerShell's startup line about an unreachable drive", () => {
  // openlore: scenario=TheDriveLineIsNotShown spec=sandbox-runner-bash
  test("is dropped before the command's output, which passes whole", () => {
    const out = collect();
    const filter = withoutPowerShellDriveNoise(out.next);
    filter.write(Buffer.concat([NOISE, Buffer.from("--- PowerShell\r\n5.1\r\n")]));
    filter.flush();
    assert.equal(out.text(), "--- PowerShell\r\n5.1\r\n");
  });

  test("is dropped when it arrives in pieces, and twice (two drives)", () => {
    const out = collect();
    const filter = withoutPowerShellDriveNoise(out.next);
    for (const piece of [NOISE.subarray(0, 20), NOISE.subarray(20), NOISE, Buffer.from("done\r\n")]) filter.write(piece);
    filter.flush();
    assert.equal(out.text(), "done\r\n");
  });

  test("a command that prints the word later keeps its line: only the start is looked at", () => {
    const out = collect();
    const filter = withoutPowerShellDriveNoise(out.next);
    filter.write(Buffer.from("first\r\n"));
    filter.write(NOISE);
    filter.flush();
    assert.equal(out.text(), "first\r\n" + NOISE.toString("latin1"));
  });

  test("a last line without its newline is not lost; output with nothing else passes untouched", () => {
    const out = collect();
    const filter = withoutPowerShellDriveNoise(out.next);
    filter.write(Buffer.from("no newline"));
    filter.flush();
    assert.equal(out.text(), "no newline");
    const only = collect();
    const alone = withoutPowerShellDriveNoise(only.next);
    alone.write(NOISE);
    alone.flush();
    assert.equal(only.text(), "", "the noise alone is the whole output: nothing shown");
  });
});

describe("the confined shell's description", () => {
  // openlore: scenario=TheAgentIsToldBackgroundProcessesEnd spec=sandbox-runner-bash
  // openlore: scenario=TheAgentIsToldThereIsNoWmi spec=sandbox-runner-bash
  test("says background processes end with their command; under MXC on Windows, that WMI is out and how to read memory", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "friction-tools-"));
    try {
      const tools = await createSandboxedTools({ root: base, allowWrite: true, allowBash: true, bashRunner: process.platform === "win32" ? "mxc" : "/usr/bin/bwrap", readExceptions: [] } as never);
      const shell = tools.find((tool) => tool.name === "bash" || tool.name === "powershell");
      assert.ok(shell);
      const guidelines = (shell.promptGuidelines ?? []).join("\n");
      assert.match(guidelines, /a process it starts in the background \(Start-Process, Start-Job, &, nohup\) ends with it/);
      if (process.platform === "win32") {
        assert.match(guidelines, /WMI is unavailable \(Get-CimInstance fails\)/);
        assert.match(guidelines, /Microsoft\.VisualBasic\.Devices\.ComputerInfo\)\.AvailablePhysicalMemory/);
      } else {
        assert.doesNotMatch(guidelines, /WMI/, "WMI is said under MXC on Windows only");
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("an unconfined shell is not told so", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "friction-tools-"));
    try {
      const tools = await createSandboxedTools({ root: base, allowWrite: true, allowBash: true, readExceptions: [] });
      const shell = tools.find((tool) => tool.name === "bash" || tool.name === "powershell");
      assert.ok(!(shell?.promptGuidelines ?? []).some((line: string) => /ends with it/.test(line)));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const python = (() => {
  try {
    return execFileSync("where.exe", ["python"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.includes("WindowsApps"));
  } catch {
    return undefined;
  }
})();

describe("under MXC's real executor on Windows", { skip: process.platform !== "win32" || !RUNNER ? "MXC_EXEC names no executor" : false }, () => {
  async function setUp() {
    const base = await realpath(await mkdtemp(path.join(tmpdir(), "friction-mxc-")));
    const root = path.join(base, "project");
    const agentDir = path.join(base, "agent");
    const data = path.join(base, "data");
    for (const dir of [root, agentDir, data]) await mkdir(dir, { recursive: true });
    return { base, root, agentDir, data };
  }
  const run = async (root: string, agentDir: string, command: string, read: string[] = []) => {
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir, ...(read.length ? { grants: () => ({ hosts: [], directories: read.map((p) => ({ path: p, access: "read" as const })) }) } : {}) });
    let output = "";
    await ops.exec(command, root, { onData: (data: Buffer) => (output += data.toString()), timeout: 120 }).catch((error: Error) => (output += `\n[${error.message}]`));
    return output;
  };

  test("the drive line, written first by the command itself, is not shown; the rest is", async () => {
    const { base, root, agentDir } = await setUp();
    try {
      const output = await run(root, agentDir, `[Console]::Out.WriteLine("La tentative d'execution de l'operation InitializeDefaultDrives sur le fournisseur FileSystem a echoue."); 'after'`);
      assert.doesNotMatch(output, /InitializeDefaultDrives/);
      assert.match(output, /after/);
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // openlore: scenario=AWalDatabaseUnderAReadGrantSaysWhatToDo spec=sandbox-runner-bash
  test("a WAL database under a read grant: the note names ?immutable=1 and a write grant; not without a read grant", { skip: !python && "no Python on the search path" }, async () => {
    const { base, root, agentDir, data } = await setUp();
    try {
      const db = path.join(data, "kb.sqlite");
      execFileSync(python!, ["-c", `import sqlite3;c=sqlite3.connect(r'${db}');c.execute('pragma journal_mode=wal');c.execute('create table t(x)');c.commit()`]);
      assert.ok(existsSync(db));
      const open = `& '${python}' -c "import sqlite3;sqlite3.connect('file:${db.replace(/\\/g, "/")}?mode=ro',uri=True).execute('select 1')" 2>&1`;
      const granted = await run(root, agentDir, open, [data]);
      assert.match(granted, /unable to open database file/, granted);
      assert.ok(granted.includes(sqliteReadOnlyNote()), granted);
      const missing = await run(root, agentDir, `& '${python}' -c "import sqlite3;sqlite3.connect('file:${path.join(root, "absent.sqlite").replace(/\\/g, "/")}?mode=ro',uri=True).execute('select 1')" 2>&1`);
      assert.match(missing, /unable to open database file/);
      assert.ok(!missing.includes("immutable=1"), "no read grant, no note");
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});
