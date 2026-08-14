/**
 * The tool sandbox itself: which tools the model is handed, and whether the
 * wrapper actually refuses a path that leaves its zone.
 *
 * sandbox.test.ts covers isWithin/isWithinAny — the predicates. This covers what
 * is built on top of them, which is where the confinement either holds or does
 * not: a read tool escaping the root, an edit tool escaping the writable zone,
 * and a symlink used to walk out of either.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createSandboxedTools, realResolve } from "../src/sandbox.ts";
import type { SandboxConfig } from "../src/config.ts";

function config(overrides: Partial<SandboxConfig> & { root: string }): SandboxConfig {
  return { allowWrite: false, allowBash: false, readExceptions: [], ...overrides } as SandboxConfig;
}

/** Run a tool's execute with just a path, which is all the wrapper inspects. */
function run(tool: { execute: (...args: never[]) => unknown }, target: string): Promise<unknown> {
  return Promise.resolve(
    (tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => unknown)("call-1", { path: target }, undefined),
  );
}

/** The error message a refused path produces, or null when the call was allowed through. */
async function denial(tool: { execute: (...args: never[]) => unknown }, target: string): Promise<string | null> {
  try {
    await run(tool, target);
  } catch (error) {
    const message = (error as Error).message;
    return message.startsWith("Access denied") ? message : null;
  }
  return null;
}

describe("realResolve", () => {
  let base: string;
  /** Windows refuses symlink creation without a privilege CI does not have. */
  let symlinksAvailable = false;

  before(async () => {
    // realResolve, not realpathSync: on Windows the async fs.realpath expands an 8.3
    // short name ("RUNNER~1" -> "runneradmin") and the sync one does not, so a fixture
    // built with realpathSync compares a short path against an expanded one and every
    // assertion here fails for a reason that has nothing to do with the code.
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-resolve-")));
    mkdirSync(path.join(base, "real"), { recursive: true });
    writeFileSync(path.join(base, "real", "file.txt"), "hi\n");
    try {
      symlinkSync(path.join(base, "real"), path.join(base, "link"), "dir");
      symlinksAvailable = true;
    } catch {
      symlinksAvailable = false;
    }
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("resolves a symlinked directory to its target", async (t) => {
    if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
    assert.equal(await realResolve(path.join(base, "link", "file.txt")), path.join(base, "real", "file.txt"));
  });

  test("keeps a tail that does not exist yet", async () => {
    // A file about to be written must still resolve, or no write could be checked
    assert.equal(await realResolve(path.join(base, "real", "new.txt")), path.join(base, "real", "new.txt"));
  });

  test("resolves the existing part of a path with a missing tail", async (t) => {
    if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
    assert.equal(await realResolve(path.join(base, "link", "deep", "new.txt")), path.join(base, "real", "deep", "new.txt"));
  });

  test("returns the target unchanged when nothing along it exists", async () => {
    const nowhere = path.join(base, "no", "such", "place");
    assert.equal(await realResolve(nowhere), nowhere);
  });
});

describe("createSandboxedTools", () => {
  let root: string;
  let outside: string;
  let writable: string;
  /** Windows refuses symlink creation without a privilege CI does not have. */
  let symlinksAvailable = false;

  before(async () => {
    // Resolve through the same primitive the code under test uses — see the note in
    // the realResolve suite above for why realpathSync is not interchangeable here
    const parent = mkdtempSync(path.join(tmpdir(), "pi-sandbox-"));
    mkdirSync(path.join(parent, "root", "src"), { recursive: true });
    mkdirSync(path.join(parent, "outside"), { recursive: true });
    root = await realResolve(path.join(parent, "root"));
    outside = await realResolve(path.join(parent, "outside"));
    writable = path.join(root, "src");
    writeFileSync(path.join(root, "readme.md"), "# hi\n");
    writeFileSync(path.join(writable, "main.ts"), "const a = 1;\n");
    writeFileSync(path.join(outside, "secret.txt"), "SECRET\n");
    // A link inside the root pointing out of it
    try {
      symlinkSync(outside, path.join(root, "escape"), "dir");
      symlinksAvailable = true;
    } catch {
      symlinksAvailable = false;
    }
  });
  after(() => rmSync(path.dirname(root), { recursive: true, force: true }));

  const names = (tools: Array<{ name: string }>) => tools.map((tool) => tool.name).sort();

  describe("which tools the model gets", () => {
    test("read-only by default", async () => {
      const tools = await createSandboxedTools(config({ root }));
      assert.deepEqual(names(tools), ["docx_extract", "find", "grep", "ls", "pdf_extract", "read", "xlsx_extract"]);
    });

    test("adds edit and write only when writing is allowed", async () => {
      const tools = await createSandboxedTools(config({ root, allowWrite: true }));
      assert.deepEqual(names(tools), ["docx_extract", "edit", "find", "grep", "ls", "pdf_extract", "read", "write", "xlsx_extract"]);
    });

    test("hands over the document readers with no shell and no writes", async () => {
      // Reading a document is reading: it must not depend on allowBash the way a
      // pdftotext-style workaround would.
      const tools = await createSandboxedTools(config({ root, allowWrite: false, allowBash: false }));
      assert.ok(names(tools).includes("pdf_extract"));
      assert.ok(names(tools).includes("docx_extract"));
      assert.ok(names(tools).includes("xlsx_extract"));
      assert.ok(!names(tools).includes("bash"));
    });

    test("adds bash only on an explicit opt-in", async () => {
      const withoutBash = await createSandboxedTools(config({ root }));
      assert.ok(!names(withoutBash).includes("bash"));
      const withBash = await createSandboxedTools(config({ root, allowBash: true }));
      assert.ok(names(withBash).includes("bash"));
    });

    test("refuses a writable zone that is not inside the root", async () => {
      await assert.rejects(
        () => createSandboxedTools(config({ root, allowWrite: true, writableRoot: outside })),
        /must be inside sandbox\.root/,
      );
    });
  });

  describe("read confinement", () => {
    test("allows a path inside the root", async () => {
      const [read] = await createSandboxedTools(config({ root }));
      assert.equal(await denial(read, "readme.md"), null);
    });

    test("refuses a path climbing out of the root", async () => {
      const [read] = await createSandboxedTools(config({ root }));
      assert.match((await denial(read, "../outside/secret.txt")) ?? "", /outside the sandbox/);
    });

    test("refuses an absolute path outside the root", async () => {
      const [read] = await createSandboxedTools(config({ root }));
      assert.match((await denial(read, path.join(outside, "secret.txt"))) ?? "", /outside the sandbox/);
    });

    test("refuses to follow a symlink out of the root", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
      const [read] = await createSandboxedTools(config({ root }));
      assert.match((await denial(read, "escape/secret.txt")) ?? "", /outside the sandbox/);
    });

    test("confines every read tool, not just the first", async () => {
      const tools = await createSandboxedTools(config({ root }));
      for (const tool of tools) {
        assert.match((await denial(tool, "../outside/secret.txt")) ?? "", /outside the sandbox/, `${tool.name} must refuse`);
      }
    });

    test("lets a path through when it lands in a declared read exception", async () => {
      const [read] = await createSandboxedTools(config({ root, readExceptions: [outside] }));
      assert.equal(await denial(read, path.join(outside, "secret.txt")), null);
    });

    test("confines pdf_extract to the same zone as the other read tools", async () => {
      const tools = await createSandboxedTools(config({ root }));
      const pdf = tools.find((tool) => tool.name === "pdf_extract");
      assert.ok(pdf !== undefined);

      assert.match((await denial(pdf, path.join(outside, "secret.pdf"))) ?? "", /outside the sandbox/);
      assert.match((await denial(pdf, "../outside/secret.pdf")) ?? "", /outside the sandbox/);
      // A prefix look-alike is a different directory, whatever its name shares
      assert.match((await denial(pdf, `${root}-evil/secret.pdf`)) ?? "", /outside the sandbox/);
    });

    test("confines docx_extract to the same zone as the other read tools", async () => {
      const tools = await createSandboxedTools(config({ root }));
      const docx = tools.find((tool) => tool.name === "docx_extract");
      assert.ok(docx !== undefined);

      assert.match((await denial(docx, path.join(outside, "secret.docx"))) ?? "", /outside the sandbox/);
      assert.match((await denial(docx, "../outside/secret.docx")) ?? "", /outside the sandbox/);
      assert.match((await denial(docx, `${root}-evil/secret.docx`)) ?? "", /outside the sandbox/);
    });

    test("lets docx_extract reach a declared read exception", async () => {
      const tools = await createSandboxedTools(config({ root, readExceptions: [outside] }));
      const docx = tools.find((tool) => tool.name === "docx_extract");
      // Allowed through confinement; it then fails on the file itself, which is
      // not a Word document — the distinction being the point of this assertion.
      assert.equal(await denial(docx!, path.join(outside, "secret.txt")), null);
    });

    test("confines xlsx_extract to the same zone as the other read tools", async () => {
      const tools = await createSandboxedTools(config({ root }));
      const xlsx = tools.find((tool) => tool.name === "xlsx_extract");
      assert.ok(xlsx !== undefined);

      assert.match((await denial(xlsx, path.join(outside, "secret.xlsx"))) ?? "", /outside the sandbox/);
      assert.match((await denial(xlsx, "../outside/secret.xlsx")) ?? "", /outside the sandbox/);
      assert.match((await denial(xlsx, `${root}-evil/secret.xlsx`)) ?? "", /outside the sandbox/);
    });

    test("refuses to follow a symlink out of the root for xlsx_extract", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
      const tools = await createSandboxedTools(config({ root }));
      const xlsx = tools.find((tool) => tool.name === "xlsx_extract");
      assert.match((await denial(xlsx!, "escape/secret.xlsx")) ?? "", /outside the sandbox/);
    });

    test("lets xlsx_extract reach a declared read exception", async () => {
      const tools = await createSandboxedTools(config({ root, readExceptions: [outside] }));
      const xlsx = tools.find((tool) => tool.name === "xlsx_extract");
      // Allowed through confinement; it then fails on the file itself, which is
      // not a workbook — the distinction being the point of this assertion.
      assert.equal(await denial(xlsx!, path.join(outside, "secret.txt")), null);
    });

    test("an xlsx destination outside the writable zone is refused too", async () => {
      // Same rule as pdf_extract: the read zone never grants a write, and each
      // extraction tool has to check its own destination.
      const tools = await createSandboxedTools(
        config({ root, allowWrite: true, readExceptions: [outside] }),
      );
      const xlsx = tools.find((tool) => tool.name === "xlsx_extract");
      await assert.rejects(
        () =>
          (xlsx!.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>)(
            "call-x",
            { path: "readme.md", output_path: path.join(outside, "out.md") },
            undefined,
          ),
        /outside the writable zone/,
      );
    });

    test("refuses to follow a symlink out of the root for pdf_extract", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
      const tools = await createSandboxedTools(config({ root }));
      const pdf = tools.find((tool) => tool.name === "pdf_extract");
      assert.match((await denial(pdf!, "escape/secret.pdf")) ?? "", /outside the sandbox/);
    });

    test("lets pdf_extract reach a declared read exception", async () => {
      const tools = await createSandboxedTools(config({ root, readExceptions: [outside] }));
      const pdf = tools.find((tool) => tool.name === "pdf_extract");
      // Allowed through confinement; it then fails on the file itself, which is
      // not a PDF — the distinction being the point of this assertion.
      assert.equal(await denial(pdf!, path.join(outside, "secret.txt")), null);
    });

    test("a read exception does not become writable for an extraction", async () => {
      // The exceptions widen reading only. A skill directory outside the root is
      // readable and must stay unwritable — the same rule edit/write follow.
      const tools = await createSandboxedTools(
        config({ root, allowWrite: true, readExceptions: [outside] }),
      );
      const pdf = tools.find((tool) => tool.name === "pdf_extract");
      const write = (target: string) =>
        (pdf!.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>)(
          "call-x",
          { path: "readme.md", output_path: target },
          undefined,
        );

      await assert.rejects(() => write(path.join(outside, "out.md")), /outside the writable zone/);
    });

    test("keeps refusing paths outside both the root and the exceptions", async () => {
      const elsewhere = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-elsewhere-")));
      try {
        const [read] = await createSandboxedTools(config({ root, readExceptions: [outside] }));
        assert.match((await denial(read, path.join(elsewhere, "x.txt"))) ?? "", /outside the sandbox/);
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    });
  });

  describe("write confinement", () => {
    /** edit and write, which are scoped to the writable zone rather than the root. */
    async function writeTools() {
      const tools = await createSandboxedTools(config({ root, allowWrite: true, writableRoot: writable }));
      return tools.filter((tool) => tool.name === "edit" || tool.name === "write");
    }

    test("allows a path inside the writable zone", async () => {
      for (const tool of await writeTools()) {
        assert.equal(await denial(tool, "src/main.ts"), null, `${tool.name} should allow it`);
      }
    });

    test("refuses a path that is readable but not writable", async () => {
      // readme.md sits in the root, which read tools may reach and write tools may not
      for (const tool of await writeTools()) {
        assert.match((await denial(tool, "readme.md")) ?? "", /outside the sandbox/, `${tool.name} must refuse`);
      }
    });

    test("still lets read tools reach what write tools cannot", async () => {
      const tools = await createSandboxedTools(config({ root, allowWrite: true, writableRoot: writable }));
      const read = tools.find((tool) => tool.name === "read")!;
      assert.equal(await denial(read, "readme.md"), null);
    });

    test("names the zone it refused against, so the message is actionable", async () => {
      const [edit] = await writeTools();
      assert.match((await denial(edit, "readme.md")) ?? "", new RegExp(writable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });

    test("read exceptions do not widen the writable zone", async () => {
      const tools = await createSandboxedTools(config({ root, allowWrite: true, writableRoot: writable, readExceptions: [outside] }));
      const write = tools.find((tool) => tool.name === "write")!;
      assert.match((await denial(write, path.join(outside, "secret.txt"))) ?? "", /outside the sandbox/);
    });
  });

  test("ignores calls that carry no path at all", async () => {
    const tools = await createSandboxedTools(config({ root, allowBash: true }));
    const bash = tools.find((tool) => tool.name === "bash")!;
    // Bash is deliberately unwrapped: a shell cannot be path-scoped, so the opt-in
    // is the whole guard. It must not be silently refused by the path wrapper either.
    assert.equal(await denial(bash, ""), null);
  });
});
