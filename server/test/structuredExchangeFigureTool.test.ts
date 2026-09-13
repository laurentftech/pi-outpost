/**
 * The `write_structure_figure` tool: what it writes, and what it refuses.
 *
 * Two failures this guards that no unit test of the drawing could. A narrowing
 * that hides everything draws a perfectly valid empty canvas — a success the
 * caller only discovers is worthless when somebody opens the file. And an
 * `output_path` is a *second* path argument, so it arrives with no confinement of
 * its own: everything keeping it inside the writable zone is in the tool.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { realResolve } from "../src/sandbox.ts";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";

/** `power` names an element kind and a relationship kind, on different things. */
const DOCUMENT = {
  schema: S,
  kind: "graph",
  data: {
    nodes: [
      { id: "p1", label: "Batterie", kind: "power" },
      { id: "c1", label: "Calculateur", kind: "compute" },
      { id: "c2", label: "Tableau de bord", kind: "compute" },
    ],
    edges: [
      { from: "c1", to: "c2", label: "400V", kind: "power" },
      { from: "p1", to: "c1", label: "état", kind: "signal" },
    ],
  },
};

describe("write_structure_figure", () => {
  let root: string;
  let outside: string;
  let tool: ReturnType<typeof createStructuredExchangeFigureToolDefinition>;

  type ToolResult = { content: { text: string }[]; isError?: boolean };

  /** Call the tool the way the agent does, with only the arguments it names. */
  async function run(params: Record<string, unknown>): Promise<ToolResult> {
    return (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<ToolResult>
    )("call-1", params, undefined);
  }

  /** The text a successful call returns, failing loudly on a refusal. */
  async function wrote(params: Record<string, unknown>): Promise<string> {
    const result = await run(params);
    assert.notEqual(result.isError, true, `expected a figure, got: ${result.content[0]?.text}`);
    return result.content[0].text;
  }

  before(async () => {
    const base = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-figuretool-")));
    root = path.join(base, "workspace");
    outside = path.join(base, "elsewhere");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(path.join(root, "figures"), { recursive: true });
    await writeFile(path.join(root, "architecture.json"), JSON.stringify(DOCUMENT, null, 2));
    await writeFile(
      path.join(root, "broken.json"),
      JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{}], edges: [] } }),
    );
    await writeFile(path.join(root, "plain.json"), JSON.stringify({ kind: "graph" }));
    await writeFile(path.join(root, "notes.md"), "# not a document\n");
    tool = createStructuredExchangeFigureToolDefinition({
      cwd: root,
      allowedRoots: [root],
      maxBytes: 4_000_000,
      writableRoot: root,
      projectRoot: root,
    });
  });

  test("is named and described so an agent reaches for it correctly", () => {
    assert.equal(tool.name, "write_structure_figure");
    // The three things an agent has to know and cannot infer: the file is
    // referenced from Markdown, the two hide lists are separate vocabularies, and
    // a table is not drawable.
    assert.match(tool.description, /Markdown/);
    assert.match(tool.description, /separate vocabularies/);
    assert.match(tool.description, /table/i);
  });

  test("writes the figure where the agent asked", async () => {
    const text = await wrote({ path: "architecture.json", output_path: "figures/power.svg" });
    const written = await readFile(path.join(root, "figures/power.svg"), "utf8");
    assert.ok(written.startsWith("<svg "), "what was written is not an SVG document");
    assert.ok(written.includes("Batterie"), "the figure does not draw the document");
    assert.match(text, /figures\/power\.svg/);
  });

  test("tells the agent how to reference what it wrote", async () => {
    // Without this the figure is a file nobody points at. The relative path is the
    // form the viewer resolves; an absolute one renders nowhere.
    const text = await wrote({ path: "architecture.json", output_path: "figures/reference.svg" });
    assert.match(text, /!\[[^\]]*\]\(figures\/reference\.svg\)/);
  });

  test("no narrowing draws the whole document, and says so", async () => {
    const text = await wrote({ path: "architecture.json", output_path: "figures/whole.svg" });
    assert.match(text, /whole document/);
    const written = await readFile(path.join(root, "figures/whole.svg"), "utf8");
    for (const label of ["Batterie", "Calculateur", "Tableau de bord", "400V", "état"]) {
      assert.ok(written.includes(label), `${label} is missing from an unnarrowed figure`);
    }
  });

  test("the two hide lists are separate vocabularies", async () => {
    // `power` is both an element kind and a relationship kind here, and they are
    // on different things — so each half of this can fail on its own.
    await wrote({
      path: "architecture.json",
      output_path: "figures/no-power-elements.svg",
      hide_element_kinds: ["power"],
    });
    const byElement = await readFile(path.join(root, "figures/no-power-elements.svg"), "utf8");
    assert.ok(!byElement.includes("Batterie"), "the power element was not hidden");
    assert.ok(byElement.includes("400V"), "hiding an element kind hid a same-named relationship");

    await wrote({
      path: "architecture.json",
      output_path: "figures/no-power-relationships.svg",
      hide_relationship_kinds: ["power"],
    });
    const byRelationship = await readFile(path.join(root, "figures/no-power-relationships.svg"), "utf8");
    assert.ok(!byRelationship.includes("400V"), "the power relationship was not hidden");
    assert.ok(byRelationship.includes("Batterie"), "hiding a relationship kind hid a same-named element");
  });

  test("the result states how much of the document the figure shows", async () => {
    const text = await wrote({
      path: "architecture.json",
      output_path: "figures/narrowed.svg",
      hide_relationship_kinds: ["signal"],
    });
    assert.match(text, /1 of 2 relationships/);
  });

  test("a narrowing that leaves nothing is reported, and nothing is written", async () => {
    const result = await run({
      path: "architecture.json",
      output_path: "figures/empty.svg",
      hide_element_kinds: ["power", "compute"],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /nothing to draw/);
    assert.equal(existsSync(path.join(root, "figures/empty.svg")), false, "an empty figure was written anyway");
  });

  test("an invalid document is refused with the reason, and nothing is written", async () => {
    const result = await run({ path: "broken.json", output_path: "figures/broken.svg" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /does not satisfy/);
    assert.equal(existsSync(path.join(root, "figures/broken.svg")), false);
  });

  test("JSON that declares nothing is refused as what it is", async () => {
    const result = await run({ path: "plain.json", output_path: "figures/plain.svg" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /declares no supported/);
  });

  test("a path outside the writable zone is refused, naming the confinement", async () => {
    await assert.rejects(
      () => run({ path: "architecture.json", output_path: path.join(outside, "escape.svg") }),
      (error: Error) => {
        assert.match(error.message, /outside the writable zone/);
        // The confinement, not the filesystem error underneath it.
        assert.doesNotMatch(error.message, /ENOENT|EACCES|EPERM/);
        return true;
      },
    );
    assert.equal(existsSync(path.join(outside, "escape.svg")), false);
  });

  test("a document outside the readable zone is refused before anything is drawn", async () => {
    await writeFile(path.join(outside, "secret.json"), JSON.stringify(DOCUMENT));
    await assert.rejects(
      () => run({ path: path.join(outside, "secret.json"), output_path: "figures/secret.svg" }),
      /outside the sandbox/,
    );
    assert.equal(existsSync(path.join(root, "figures/secret.svg")), false);
  });

  test("a read-only sandbox refuses every destination", async () => {
    const readOnly = createStructuredExchangeFigureToolDefinition({
      cwd: root,
      allowedRoots: [root],
      maxBytes: 4_000_000,
      writableRoot: null,
      projectRoot: root,
    });
    await assert.rejects(
      () =>
        (readOnly.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-2", {
          path: "architecture.json",
          output_path: "figures/read-only.svg",
        }),
      /read-only/,
    );
  });

  test("a destination that is not an .svg is refused, and says why", async () => {
    // Not fussiness: the raw-file route picks its content type by extension, so a
    // figure under another name is a file the preview will never render.
    await assert.rejects(
      () => run({ path: "architecture.json", output_path: "figures/power.txt" }),
      /must be named \.svg/,
    );
  });

  test("makes the folder the figure goes in", async () => {
    // Found by running it: figures collect in a directory of their own, and that
    // directory does not exist until the first figure is written. Refusing left a
    // sandboxed agent stuck — it has `write` and `edit` and no mkdir.
    await wrote({ path: "architecture.json", output_path: "reports/q3/figures/power.svg" });
    const written = await readFile(path.join(root, "reports/q3/figures/power.svg"), "utf8");
    assert.ok(written.startsWith("<svg "));
  });

  test("makes no folder outside the writable zone", async () => {
    // The confinement runs before anything is created, so a refused destination
    // leaves no directory behind either.
    await assert.rejects(
      () => run({ path: "architecture.json", output_path: path.join(outside, "made/up/power.svg") }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "made")), false, "a folder was created outside the zone");
  });

  test("an existing file is never overwritten", async () => {
    await writeFile(path.join(root, "figures/taken.svg"), "mine\n");
    await assert.rejects(() => run({ path: "architecture.json", output_path: "figures/taken.svg" }), /already exists/);
    assert.equal(await readFile(path.join(root, "figures/taken.svg"), "utf8"), "mine\n");
  });

  test("a missing document is reported as missing", async () => {
    await assert.rejects(() => run({ path: "nowhere.json", output_path: "figures/nowhere.svg" }), /No such file/);
  });

  test("a refusal writes nothing at all, not even an empty file", async () => {
    // Every refusal above checks its own path; this checks the directory, so a
    // stray file from any of them would show up here.
    const written = await readdir(path.join(root, "figures"));
    for (const name of written) {
      const contents = await readFile(path.join(root, "figures", name), "utf8");
      assert.ok(contents.length > 0, `${name} is empty`);
    }
  });
});
