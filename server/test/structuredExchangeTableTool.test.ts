/**
 * `write_structure_table`: a table into the workspace, as Markdown.
 *
 * Driven as the agent calls it. What matters is on disk — the file written, or no file
 * at all — so every refusal is followed by a check that nothing appeared and nothing
 * existing changed.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { StructuredTableData } from "@pi-outpost/shared/structured-exchange";
import { tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";
import { createStructuredExchangeTableToolDefinition } from "../src/structuredExchangeTableTool.ts";
import { realResolve } from "../src/sandbox.ts";

type ToolResult = { content: { text: string }[]; isError?: boolean };

const specification = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  data: {
    columns: ["id", "requirement"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      { id: "req-1", kind: "requirement", cells: ["REQ-1", "Stop within 40 m"], attributes: { category: "derived" } },
      { heading: "2. Warning", depth: 1 },
      { id: "req-2", kind: "requirement", cells: ["REQ-2", "Warn the driver"] },
    ],
    relations: [{ from: { id: "req-1" }, to: { id: "req-2" }, kind: "satisfies" }],
  },
};

const graph = {
  schema: "urn:structured-exchange:2",
  kind: "graph",
  data: { nodes: [{ id: "a", label: "A" }], edges: [] },
};

describe("write_structure_table", () => {
  let base: string;
  let counter = 0;

  function project(files: Record<string, unknown> = {}): string {
    const root = path.join(base, `project-${counter++}`);
    const all: Record<string, unknown> = { "spec.json": specification, "graph.json": graph, ...files };
    for (const [relative, content] of Object.entries(all)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return root;
  }

  const run = (root: string, params: Record<string, unknown>, writableRoot: string | null = root) =>
    (
      createStructuredExchangeTableToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 4_000_000, writableRoot, projectRoot: root })
        .execute as unknown as (id: string, params: unknown) => Promise<ToolResult>
    )("call-1", params);

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-table-tool-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("writes a table as the Markdown export, each chapter a heading followed by its rows", async () => {
    // TheAgentWritesATableAsMarkdown
    const root = project();
    const result = await run(root, { path: "spec.json", output_path: "docs/specification.md" });
    assert.notEqual(result.isError, true, result.content[0].text);
    const written = readFileSync(path.join(root, "docs/specification.md"), "utf8");
    assert.equal(written, tableMarkdown(specification.data as unknown as StructuredTableData));
    assert.match(written, /^## 1\. Braking\n\n\| id \| requirement \|/);
    assert.match(written, /## 2\. Warning/);
    assert.match(result.content[0].text, /2 rows in 2 chapters/);
  });

  test("is available and works in a project with no profile registry", async () => {
    const root = project();
    assert.equal(existsSync(path.join(root, ".pi-outpost")), false);
    const result = await run(root, { path: "spec.json", output_path: "spec.md" });
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.ok(existsSync(path.join(root, "spec.md")));
  });

  test("refuses a graph, naming the figure tool, and writes nothing", async () => {
    // OnlyATableIsWrittenAsMarkdown
    const root = project();
    const result = await run(root, { path: "graph.json", output_path: "graph.md" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /is a graph, not a table; draw it with write_structure_figure/);
    assert.equal(existsSync(path.join(root, "graph.md")), false);
  });

  test("never overwrites an existing file, and refuses a destination not ending in .md", async () => {
    // AnExistingFileIsNeverOverwritten
    const root = project({ "docs/existing.md": "# Mine\n" });
    await assert.rejects(() => run(root, { path: "spec.json", output_path: "docs/existing.md" }), /already exists/);
    assert.equal(readFileSync(path.join(root, "docs/existing.md"), "utf8"), "# Mine\n");
    await assert.rejects(() => run(root, { path: "spec.json", output_path: "docs/specification.txt" }), /must be named \.md/);
    assert.equal(existsSync(path.join(root, "docs/specification.txt")), false);
  });

  test("writes only inside the writable zone, and not at all in a read-only sandbox", async () => {
    // ATableIsWrittenOnlyInsideTheWritableZone
    const root = project();
    const outside = path.join(base, `outside-${counter}.md`);
    await assert.rejects(() => run(root, { path: "spec.json", output_path: outside }));
    assert.equal(existsSync(outside), false);

    const writable = path.join(root, "work");
    mkdirSync(writable, { recursive: true });
    await assert.rejects(() => run(root, { path: "spec.json", output_path: "elsewhere.md" }, writable));
    assert.equal(existsSync(path.join(root, "elsewhere.md")), false);

    await assert.rejects(() => run(root, { path: "spec.json", output_path: "readonly.md" }, null), /read-only/);
    assert.equal(existsSync(path.join(root, "readonly.md")), false);
  });

  test("does not write a table that breaks one of the project's refuse rules", async () => {
    // ATableStrayingFromItsProfileIsNotWritten
    const root = project({
      ".pi-outpost/structured-exchange.json": { schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"], rules: ["rules/project.json"] },
      "profiles/requirements.json": {
        schema: "urn:structured-exchange-profile:1",
        id: "acme/requirements",
        label: "ACME requirements",
        elementKinds: [{ kind: "requirement", attributes: [{ name: "category", type: "enumeration", values: ["derived", "refined", "direct"], closed: true }] }],
        relationshipKinds: [{ kind: "satisfies" }],
      },
      "rules/project.json": {
        schema: "urn:structured-exchange-rules:1",
        profile: "acme/requirements",
        rules: [
          { id: "ARP4754A-derived-no-satisfy", statement: "A derived requirement does not satisfy an upstream one.", level: "refuse", relationship: "satisfies", when: { from: { category: ["derived"] } }, then: "forbidden" },
        ],
      },
    });
    const result = await run(root, { path: "spec.json", output_path: "docs/specification.md" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No table was written/);
    assert.match(result.content[0].text, /rule\/ARP4754A-derived-no-satisfy at \/data\/relations\/0/);
    assert.equal(existsSync(path.join(root, "docs/specification.md")), false);
  });

  test("refuses a document that breaks the core contract, writing nothing", async () => {
    const root = project({ "broken.json": { schema: "urn:structured-exchange:2", kind: "table", data: { columns: ["id"], rows: [["a", "b"]] } } });
    const result = await run(root, { path: "broken.json", output_path: "broken.md" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /does not satisfy the structured-exchange contract/);
    assert.equal(existsSync(path.join(root, "broken.md")), false);
  });

  test("is described so an agent reaches for it for tables and for the figure tool otherwise", () => {
    const tool = createStructuredExchangeTableToolDefinition({ cwd: base, allowedRoots: [base], maxBytes: 1, writableRoot: base, projectRoot: base });
    assert.equal(tool.name, "write_structure_table");
    assert.match(tool.description, /Markdown \(\.md\) file/);
    assert.match(tool.description, /write_structure_figure/);
  });
});
