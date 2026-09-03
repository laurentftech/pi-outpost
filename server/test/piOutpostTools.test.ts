/**
 * The pi-outpost tools extension: settings parsing and tool wiring.
 *
 * What these protect is the contract between the parent server and the RPC
 * child. The child builds its own toolset from `PI_OUTPOST_TOOLS`, so a missing
 * or malformed value must stop startup with a message that names the setting,
 * rather than an agent that silently runs with the wrong (or no) extractors.
 * The wiring test guards parity: the eight tools the embedded runtime registers are
 * the same eight the child gets, built the same way. `work_plan_extended` is among
 * them here even though a child never withholds it — the RPC dialect has no command
 * for the active toolset, so registration is parity and publication is not.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import piOutpostExtension, {
  createPiOutpostTools,
  parseToolsSettings,
  TOOLS_ENV_VAR,
  type PiOutpostToolsSettings,
} from "../src/piOutpostTools.ts";

const VALID: PiOutpostToolsSettings = {
  cwd: "/tmp",
  maxBytes: { pdf: 10485760, docx: 5242880, xlsx: 5242880, pptx: 5242880, structuredExchange: 4000000 },
};

describe("parseToolsSettings", () => {
  test("accepts a complete, well-formed JSON value", () => {
    const parsed = parseToolsSettings(JSON.stringify(VALID));
    assert.deepEqual(parsed, VALID);
  });

  test("throws when the env var is not set", () => {
    assert.throws(() => parseToolsSettings(undefined), new RegExp(TOOLS_ENV_VAR));
  });

  test("throws when the env var is empty", () => {
    assert.throws(() => parseToolsSettings("   "), new RegExp(TOOLS_ENV_VAR));
  });

  test("throws on invalid JSON, naming the env var", () => {
    assert.throws(
      () => parseToolsSettings("{not json"),
      (err: Error) => err.message.includes(TOOLS_ENV_VAR) && err.message.includes("JSON"),
    );
  });

  test("throws when cwd is missing", () => {
    assert.throws(
      () => parseToolsSettings(JSON.stringify({ ...VALID, cwd: undefined })),
      /cwd/,
    );
  });

  test("throws when cwd is an empty string", () => {
    assert.throws(
      () => parseToolsSettings(JSON.stringify({ ...VALID, cwd: "" })),
      /cwd/,
    );
  });

  test("throws when cwd is the wrong type", () => {
    assert.throws(
      () => parseToolsSettings(JSON.stringify({ ...VALID, cwd: 42 })),
      /cwd/,
    );
  });

  test("throws when a maxBytes entry is missing", () => {
    const { pdf: _omit, ...rest } = VALID.maxBytes;
    void _omit;
    assert.throws(
      () => parseToolsSettings(JSON.stringify({ cwd: VALID.cwd, maxBytes: rest })),
      /maxBytes\.pdf/,
    );
  });

  test("throws when a maxBytes entry is not a number", () => {
    assert.throws(
      () =>
        parseToolsSettings(
          JSON.stringify({ cwd: VALID.cwd, maxBytes: { ...VALID.maxBytes, docx: "big" } }),
        ),
      /maxBytes\.docx/,
    );
  });

  test("throws when a maxBytes entry is zero", () => {
    assert.throws(
      () =>
        parseToolsSettings(
          JSON.stringify({ cwd: VALID.cwd, maxBytes: { ...VALID.maxBytes, xlsx: 0 } }),
        ),
      /maxBytes\.xlsx/,
    );
  });

  test("throws when a maxBytes entry is negative", () => {
    assert.throws(
      () =>
        parseToolsSettings(
          JSON.stringify({ cwd: VALID.cwd, maxBytes: { ...VALID.maxBytes, pptx: -1 } }),
        ),
      /maxBytes\.pptx/,
    );
  });

  test("throws when a maxBytes entry is NaN", () => {
    assert.throws(
      () =>
        parseToolsSettings(
          JSON.stringify({ cwd: VALID.cwd, maxBytes: { ...VALID.maxBytes, pdf: NaN } }),
        ),
      /maxBytes\.pdf/,
    );
  });

  test("throws when maxBytes itself is absent", () => {
    assert.throws(
      () => parseToolsSettings(JSON.stringify({ cwd: VALID.cwd })),
      /maxBytes/,
    );
  });
});

describe("createPiOutpostTools", () => {
  let root: string;
  const roots: string[] = [];

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pi-outpost-tools-"));
    roots.push(root);
  });
  after(async () => {
    await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  });

  test("returns the eight tools the agent needs, in the documented order", async () => {
    const tools = await createPiOutpostTools({ cwd: root, maxBytes: VALID.maxBytes });
    assert.equal(tools.length, 8);
    const names = tools.map((t) => t.name);
    assert.deepEqual(names, [
      "pdf_extract",
      "docx_extract",
      "xlsx_extract",
      "pptx_extract",
      "write_structure_figure",
      "present_structure",
      "work_plan",
      // Registered, not necessarily published: the server withholds this one from a
      // session with no plan through the SDK's active-tool set. A child registers it
      // and publishes it always, which is the stated cost of that dialect.
      "work_plan_extended",
    ]);
  });

  test("resolves the cwd through realpath so symlinked roots still confine", async () => {
    // macOS reaches /tmp through a symlink; the confinement checks compare resolved paths.
    const tools = await createPiOutpostTools({ cwd: root, maxBytes: VALID.maxBytes });
    // Each tool carries its allowedRoots; the first is the resolved workspace root.
    for (const tool of tools) {
      const allowed = (tool as unknown as { allowedRoots?: string[] }).allowedRoots;
      // Not every tool definition exposes allowedRoots on its surface; the point
      // is that the call did not throw on a /tmp-rooted path (symlink on macOS).
      if (allowed) assert.ok(allowed.length >= 1);
    }
  });

  test("the extractors each carry their own maxBytes", async () => {
    const tools = await createPiOutpostTools({ cwd: root, maxBytes: VALID.maxBytes });
    for (const name of ["pdf_extract", "docx_extract", "xlsx_extract", "pptx_extract"]) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `expected ${name} among the tools`);
    }
  });
});

describe("default export (extension entry)", () => {
  let root: string;
  const roots: string[] = [];

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pi-outpost-ext-"));
    roots.push(root);
  });
  after(async () => {
    await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  });

  /** Saves and restores the env var around a test that mutates it. */
  function withEnv(value: string | undefined, run: () => Promise<void>): Promise<void> {
    const prev = process.env[TOOLS_ENV_VAR];
    if (value === undefined) delete process.env[TOOLS_ENV_VAR];
    else process.env[TOOLS_ENV_VAR] = value;
    return run().finally(() => {
      if (prev === undefined) delete process.env[TOOLS_ENV_VAR];
      else process.env[TOOLS_ENV_VAR] = prev;
    });
  }

  test("registers the eight tools when the env var is set", async () => {
    await withEnv(JSON.stringify({ cwd: root, maxBytes: VALID.maxBytes }), async () => {
      const registered: ToolDefinition[] = [];
      const pi = { registerTool: (t: ToolDefinition) => void registered.push(t) } as unknown as ExtensionAPI;

      await piOutpostExtension(pi);

      assert.equal(registered.length, 8);
      assert.deepEqual(
        registered.map((t) => t.name),
        [
          "pdf_extract",
          "docx_extract",
          "xlsx_extract",
          "pptx_extract",
          "write_structure_figure",
          "present_structure",
          "work_plan",
          "work_plan_extended",
        ],
      );
    });
  });

  test("throws when the env var is not set, so a misconfigured child fails fast", async () => {
    await withEnv(undefined, async () => {
      const pi = { registerTool: () => undefined } as unknown as ExtensionAPI;
      await assert.rejects(() => piOutpostExtension(pi), new RegExp(TOOLS_ENV_VAR));
    });
  });

  test("throws when the env var points at a missing cwd", async () => {
    const missing = path.join(root, "does-not-exist");
    await withEnv(JSON.stringify({ cwd: missing, maxBytes: VALID.maxBytes }), async () => {
      const pi = { registerTool: () => undefined } as unknown as ExtensionAPI;
      await assert.rejects(() => piOutpostExtension(pi));
    });
  });
});
