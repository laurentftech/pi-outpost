/**
 * `pi-outpost config --confine`: the file is changed only when the runner proved it confines,
 * and then by one key, in the file's own layout. The verdict is given here; the command's
 * wiring to the real CLI is `config-cli.test.mjs`'s.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import { parseCli } from "../src/cli.ts";
import { confineConfiguration, serializeLike } from "../src/confineCommand.ts";

const verified: ConfinementVerdict = { state: "verified", runner: "/r", checkedAt: "2026-11-01T10:00:00Z", refused: ["agent-directory"], notChecked: [] };
const leaking: ConfinementVerdict = { state: "leaking", runner: "/r", checkedAt: "2026-11-01T10:00:00Z", reached: ["agent-directory"], refused: [] };
const oldBuild: ConfinementVerdict = {
  state: "failed",
  runner: "/r",
  checkedAt: "2026-11-01T10:00:00Z",
  reason: "bash is confined by wxc-exec.exe, which cannot run it: MXC would confine terminals with tier \"appcontainer-dacl\". This machine is Windows build 26100.8000",
};

/** A configuration in a CRLF file with four-space indentation and a key order the command must keep. */
const CRLF_CONFIG = ['{', '    "port": 4000,', '    "sandbox": {', '        "root": ".",', '        "allowBash": true,', '        "allowWrite": true', '    },', '    "branding": {', '        "title": "x"', '    }', '}', ''].join("\r\n");

async function inDir<T>(content: string | undefined, fn: (dir: string, file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-outpost-confine-"));
  try {
    const file = path.join(dir, "pi-outpost.config.json");
    if (content !== undefined) await writeFile(file, content);
    return await fn(dir, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const confine = (dir: string, file: string | undefined, verdict: ConfinementVerdict, calls = { count: 0 }) =>
  confineConfiguration({
    launchDir: dir,
    flags: file ? { config: file } : {},
    env: { XDG_CONFIG_HOME: path.join(dir, "xdg"), APPDATA: path.join(dir, "xdg"), PATH: process.env.PATH ?? process.env.Path ?? "" },
    agentDir: path.join(dir, "agent"),
    verdict: async () => {
      calls.count += 1;
      return verdict;
    },
  });

/** Whether this platform has a runner `"auto"` could take, without which the command refuses before any canary. */
const hasRunner = async () =>
  inDir(JSON.stringify({ sandbox: { root: ".", allowBash: true, bashRunner: "auto" } }), async (dir, file) => {
    const { loadConfig } = await import("../src/config.ts");
    return loadConfig(dir, { config: file }, process.env, { quiet: true }).sandbox!.autoRunner?.unavailable === undefined;
  });

describe("pi-outpost config --confine", () => {
  test("--confine belongs to config", () => {
    assert.equal(parseCli(["config", "--confine"]).config.confine, true);
    assert.equal(parseCli(["config"]).config.confine, false);
    assert.throws(() => parseCli(["--confine"]), /"--confine" belongs to "pi-outpost config"/);
    assert.throws(() => parseCli(["doctor", "--confine"]), /"--confine" belongs to "pi-outpost config"/);
  });

  // openlore: scenario=ConfineOnACapableMachine spec=sandbox-defaults
  test("ConfineOnACapableMachine: one key added, the layout, line endings and key order kept, the change printed", async (t) => {
    if (!(await hasRunner())) return t.skip("no runner on this platform for \"auto\" to take");
    await inDir(CRLF_CONFIG, async (dir, file) => {
      const result = await confine(dir, file, verified);
      assert.equal(result.exitCode, 0, result.lines.join("\n"));
      const written = await readFile(file, "utf8");
      const expected = CRLF_CONFIG.replace('"allowWrite": true\r\n', '"allowWrite": true,\r\n        "bashRunner": "auto"\r\n');
      assert.equal(written, expected, "only bashRunner was added, nothing else moved");
      assert.match(result.lines.join("\n"), /"sandbox\.bashRunner": \(absent\) → "auto"/);
      assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), [], "no rehearsal file is left behind");
    });
  });

  test("an explicit \"none\" is replaced where it stands", async (t) => {
    if (!(await hasRunner())) return t.skip("no runner on this platform for \"auto\" to take");
    const content = `${JSON.stringify({ sandbox: { root: ".", allowBash: true, bashRunner: "none", allowWrite: true } }, null, 2)}\n`;
    await inDir(content, async (dir, file) => {
      assert.equal((await confine(dir, file, verified)).exitCode, 0);
      assert.equal(await readFile(file, "utf8"), content.replace('"none"', '"auto"'));
    });
  });

  // openlore: scenario=ConfineRefusesOnAnIncapableMachine spec=sandbox-defaults
  test("ConfineRefusesOnAnIncapableMachine: the file byte for byte unchanged, the reason printed, a non-zero exit", async (t) => {
    if (!(await hasRunner())) return t.skip("no runner on this platform for \"auto\" to take");
    await inDir(CRLF_CONFIG, async (dir, file) => {
      const result = await confine(dir, file, oldBuild);
      assert.equal(result.exitCode, 1);
      assert.equal(await readFile(file, "utf8"), CRLF_CONFIG);
      assert.match(result.lines.join("\n"), /unchanged[\s\S]*26100\.8000[\s\S]*"sandbox\.bashRunner": "none"/);
      assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
    });
  });

  // openlore: scenario=ConfineRefusesWhenTheCanaryLeaks spec=sandbox-defaults
  test("ConfineRefusesWhenTheCanaryLeaks: unchanged, naming what the canary reached", async (t) => {
    if (!(await hasRunner())) return t.skip("no runner on this platform for \"auto\" to take");
    await inDir(CRLF_CONFIG, async (dir, file) => {
      const result = await confine(dir, file, leaking);
      assert.equal(result.exitCode, 1);
      assert.equal(await readFile(file, "utf8"), CRLF_CONFIG);
      assert.match(result.lines.join("\n"), /read the agent directory/);
    });
  });

  test("a file edited while the canary runs is not overwritten", async (t) => {
    if (!(await hasRunner())) return t.skip("no runner on this platform for \"auto\" to take");
    await inDir(CRLF_CONFIG, async (dir, file) => {
      const edited = CRLF_CONFIG.replace('"port": 4000', '"port": 4001');
      const result = await confineConfiguration({
        launchDir: dir,
        flags: { config: file },
        env: { XDG_CONFIG_HOME: path.join(dir, "xdg"), APPDATA: path.join(dir, "xdg"), PATH: process.env.PATH ?? process.env.Path ?? "" },
        agentDir: path.join(dir, "agent"),
        verdict: async () => {
          await writeFile(file, edited); // the user, or a server persisting Settings, meanwhile
          return verified;
        },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(await readFile(file, "utf8"), edited, "the edit made during the check is kept");
      assert.match(result.lines.join("\n"), /changed while[\s\S]*run "pi-outpost config --confine" again/);
      assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
    });
  });

  // openlore: scenario=AlreadyConfinedIsANoOp spec=sandbox-defaults
  test("AlreadyConfinedIsANoOp: \"auto\", \"mxc\" or a path: unchanged, exit 0, no canary", async () => {
    for (const bashRunner of ["auto", "mxc", "./bin/landstrip"]) {
      const content = JSON.stringify({ sandbox: { root: ".", allowBash: true, bashRunner } });
      await inDir(content, async (dir, file) => {
        const calls = { count: 0 };
        const result = await confine(dir, file, verified, calls);
        assert.equal(result.exitCode, 0);
        assert.equal(await readFile(file, "utf8"), content);
        assert.match(result.lines.join("\n"), new RegExp(`already confined by ${JSON.stringify(JSON.stringify(bashRunner)).slice(1, -1).replace(/[./]/g, "\\$&")}`));
        assert.equal(calls.count, 0);
      });
    }
  });

  // openlore: scenario=NoShellNothingToConfine spec=sandbox-defaults
  test("NoShellNothingToConfine: bash off, or the extension's: unchanged, saying pi-outpost's shell is not in use", async () => {
    for (const sandbox of [{ root: "." }, { root: ".", allowBash: false }, { root: ".", allowBash: true, bashFrom: "npm:pi-landstrip" }]) {
      const content = JSON.stringify({ sandbox });
      await inDir(content, async (dir, file) => {
        const result = await confine(dir, file, verified);
        assert.equal(result.exitCode, 0);
        assert.equal(await readFile(file, "utf8"), content);
        assert.match(result.lines.join("\n"), /pi-outpost's own shell is not in use/);
      });
    }
  });

  // openlore: scenario=SandboxFalseIsNotOverridden spec=sandbox-defaults
  test("SandboxFalseIsNotOverridden: unchanged, saying it must be turned back on by hand", async () => {
    const content = JSON.stringify({ sandbox: false });
    await inDir(content, async (dir, file) => {
      const result = await confine(dir, file, verified);
      assert.equal(result.exitCode, 1);
      assert.equal(await readFile(file, "utf8"), content);
      assert.match(result.lines.join("\n"), /"sandbox" is false[\s\S]*by hand/);
    });
  });

  // openlore: scenario=NoFileUsesTheDefault spec=sandbox-defaults
  test("NoFileUsesTheDefault: no file is created, and the default is explained", async () => {
    await inDir(undefined, async (dir) => {
      const result = await confine(dir, undefined, verified);
      assert.equal(result.exitCode, 0);
      assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".json")), []);
      assert.match(result.lines.join("\n"), /default sandbox already chooses a runner automatically/);
    });
    // A file without a section is the default already.
    await inDir("{}\n", async (dir, file) => {
      const result = await confine(dir, file, verified);
      assert.equal(result.exitCode, 0);
      assert.equal(await readFile(file, "utf8"), "{}\n");
    });
  });

  test("serializeLike keeps tabs, LF and a missing final newline", () => {
    assert.equal(serializeLike('{\n\t"a": 1\n}', { a: 1, b: 2 }), '{\n\t"a": 1,\n\t"b": 2\n}');
  });
});
