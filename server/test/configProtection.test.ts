/**
 * The configuration names the sandbox, so none of the agent's tools may write it — the default
 * sandbox makes the project writable, and the project often holds `pi-outpost.config.json`.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { assertWritableDestination } from "../src/extractionOutput.ts";
import { createSandboxedTools, protectFromWrites } from "../src/sandbox.ts";

type Executable = (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>;

describe("the configuration file is protected from the agent's writes", () => {
  let root: string;
  let configFile: string;
  const original = `${JSON.stringify({ sandbox: { root: ".", allowWrite: true, allowBash: true, bashRunner: "auto" } }, null, 2)}\n`;
  before(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "config-protection-")));
    configFile = path.join(root, "pi-outpost.config.json");
    await writeFile(configFile, original);
    protectFromWrites(configFile);
  });
  after(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  const ctx = () => ({ cwd: root, sessionManager: { getSessionId: () => "protection", getSessionFile: () => undefined } });

  test("write and edit refuse it, under any spelling of its path, and the file is unchanged", async () => {
    const tools = await createSandboxedTools({ root, allowWrite: true, allowBash: false, readExceptions: [] });
    const write = tools.find((tool) => tool.name === "write")!.execute as unknown as Executable;
    const edit = tools.find((tool) => tool.name === "edit")!.execute as unknown as Executable;
    const spellings = ["pi-outpost.config.json", "./sub/../pi-outpost.config.json", configFile, ...(process.platform === "win32" ? ["PI-OUTPOST.CONFIG.JSON"] : [])];
    for (const target of spellings) {
      await assert.rejects(
        write("w", { path: target, content: '{ "sandbox": { "bashRunner": "none" } }' }, undefined, undefined, ctx()),
        /pi-outpost's configuration, which sets the sandbox/,
        target,
      );
    }
    await assert.rejects(
      edit("e", { path: "pi-outpost.config.json", edits: [{ oldText: '"auto"', newText: '"none"' }] }, undefined, undefined, ctx()),
      /pi-outpost's configuration/,
    );
    assert.equal(await readFile(configFile, "utf8"), original);
    // Anything else in the project is still writable.
    await write("w", { path: "notes.txt", content: "fine" }, undefined, undefined, ctx());
    assert.equal(await readFile(path.join(root, "notes.txt"), "utf8"), "fine");
  });

  test("a document tool's destination is refused the same way", async () => {
    await assert.rejects(assertWritableDestination("pi-outpost.config.json", { cwd: root, writableRoot: root } as never), /pi-outpost's configuration/);
    assert.equal(await assertWritableDestination("out.md", { cwd: root, writableRoot: root } as never), path.join(root, "out.md"));
  });
});
