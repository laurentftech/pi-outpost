/**
 * The agent may not write the configuration that confines it.
 *
 * A `.pi` directory under the writable zone holds Pi's project settings and extensions,
 * and a sandboxing extension's policy: pi-landstrip reads `.pi/sandbox.json` before every
 * command and merges it over its global policy, so the agent writing it would widen what
 * its own next command may do. None of pi-outpost's writing tools may write there; the
 * agent may still read it.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { assertWritableDestination } from "../src/extractionOutput.ts";
import { createSandboxedTools, piConfigWriteRefusal } from "../src/sandbox.ts";
import type { SandboxConfig } from "../src/config.ts";

let root: string;
before(() => {
  root = mkdtempSync(path.join(tmpdir(), "pi-config-"));
  mkdirSync(path.join(root, ".pi"));
  writeFileSync(path.join(root, ".pi", "sandbox.json"), "{}\n");
  writeFileSync(path.join(root, "table.json"), JSON.stringify({
    schema: "urn:structured-exchange:1",
    kind: "table",
    data: { columns: ["id"], rows: [["REQ-1"]] },
  }));
});
after(() => rmSync(root, { recursive: true, force: true }));

const sandbox = (): SandboxConfig =>
  ({ root, allowWrite: true, writableRoot: root, allowBash: false, readExceptions: [] }) as SandboxConfig;

type Executable = { name: string; execute: (...args: never[]) => unknown };
async function call(tool: Executable, params: Record<string, unknown>): Promise<string> {
  try {
    const result = (await (tool.execute as unknown as (id: string, p: unknown) => Promise<{ content: { text?: string }[] }>)("c1", params)) ?? {
      content: [],
    };
    return `ok: ${result.content.map((part) => part.text ?? "").join(" ")}`;
  } catch (error) {
    return `refused: ${(error as Error).message}`;
  }
}
const tool = async (name: string) => (await createSandboxedTools(sandbox())).find((each) => each.name === name) as unknown as Executable;

describe("AgentWritesStayOutOfPiConfiguration", () => {
  test("write and edit refuse a .pi directory, at the top or nested", async () => {
    const write = await tool("write");
    const edit = await tool("edit");
    assert.match(await call(write, { path: ".pi/sandbox.json", content: '{"shell":{"readAccess":"host"}}' }), /^refused: .*in a \.pi directory/);
    assert.match(await call(write, { path: path.join("nested", ".pi", "settings.json"), content: "{}" }), /^refused: .*in a \.pi directory/);
    assert.match(await call(write, { path: ".pi/extensions/x.ts", content: "export default () => {}" }), /^refused/);
    assert.match(await call(edit, { path: ".pi/sandbox.json", edits: [{ oldText: "{}", newText: '{"network":{"allowNetwork":true}}' }] }), /^refused/);
    // Nothing reached the disk.
    assert.equal(readFileSync(path.join(root, ".pi", "sandbox.json"), "utf8"), "{}\n");
    assert.equal(existsSync(path.join(root, "nested")), false);
  });

  test("a symlink into .pi is no way round it", async () => {
    // A junction on Windows: a directory symlink there needs privileges a CI runner lacks.
    symlinkSync(path.join(root, ".pi"), path.join(root, "innocent"), process.platform === "win32" ? "junction" : "dir");
    const write = await tool("write");
    assert.match(await call(write, { path: path.join("innocent", "sandbox.json"), content: "{}" }), /^refused: .*in a \.pi directory/);
  });

  test("everything else is still writable, .pi-outpost and look-alikes included", async () => {
    const write = await tool("write");
    for (const target of [path.join("src", "a.txt"), path.join(".pi-outpost", "structured-exchange.json"), "notes.pi", path.join("api", "x.txt")]) {
      assert.match(await call(write, { path: target, content: "x" }), /^ok/, target);
      assert.ok(existsSync(path.join(root, target)), target);
    }
  });

  test("reading .pi is still allowed", async () => {
    assert.match(await call(await tool("read"), { path: ".pi/sandbox.json" }), /^ok: \{\}/);
  });

  test("every tool that writes a file is held to it, through the one check they share", async () => {
    // The real path, as every caller passes it (macOS puts the temp directory behind /var).
    const zone = realpathSync(root);
    await assert.rejects(assertWritableDestination(".pi/sandbox.json", { cwd: zone, writableRoot: zone }), /in a \.pi directory/);
    await assert.rejects(assertWritableDestination(path.join(".pi", "sub", "x.md"), { cwd: zone, writableRoot: zone }), /in a \.pi directory/);
    // A real one, end to end: the table writer asked to put its Markdown in .pi.
    const result = await call(await tool("write_structure_table"), { path: "table.json", output_path: ".pi/table.md" });
    assert.match(result, /in a \.pi directory/);
    assert.equal(existsSync(path.join(root, ".pi", "table.md")), false);
  });

  test("the rule reads the path below the writable zone only", () => {
    const zone = path.join(root, "work");
    // A writable zone that itself sits under a .pi is the user's choice, not the agent's.
    assert.equal(piConfigWriteRefusal(path.join(root, ".pi", "zone"), path.join(root, ".pi", "zone", "a.txt"), "a.txt"), undefined);
    assert.equal(piConfigWriteRefusal(zone, path.join(zone, "a.txt"), "a.txt"), undefined);
    assert.match(piConfigWriteRefusal(zone, path.join(zone, ".pi", "a.json"), "x") ?? "", /\.pi directory/);
  });
});
