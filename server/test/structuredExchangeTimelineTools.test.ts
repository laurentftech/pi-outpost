/**
 * A timeline through the agent's tools.
 *
 * The agent never sees the rendering, so what it is told back is the whole of what
 * it learns: the counts, and every dependency the dates break. And the two tools
 * that write files must refuse a timeline plainly rather than write something, or
 * advise drawing it with the other one.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { createStructuredExchangeTableToolDefinition } from "../src/structuredExchangeTableTool.ts";
import { realResolve } from "../src/sandbox.ts";

type ToolResult = { content: { text: string }[]; details?: unknown; isError?: boolean };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROGRAMME = path.resolve(HERE, "../../shared/conformance/valid/v3-timeline-programme.json");
/* eslint-disable @typescript-eslint/no-explicit-any */
const programme = (): any => JSON.parse(readFileSync(PROGRAMME, "utf8"));

describe("a timeline through the agent's tools", () => {
  let base: string;
  let counter = 0;

  function project(files: Record<string, unknown> = {}): string {
    const root = path.join(base, `project-${counter++}`);
    mkdirSync(root, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return root;
  }

  const present = (projectRoot: string, document: unknown) =>
    (createStructuredExchangeToolDefinition({ projectRoot }).execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)(
      "call-1",
      { document: JSON.stringify(document), summary: "Programme X schedule." },
    );

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-timeline-tools-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("the tool's description tells the agent how to write a timeline", () => {
    const tool = createStructuredExchangeToolDefinition({ projectRoot: project() });
    assert.match(tool.description, /timeline/);
    const parameter = JSON.stringify(tool.parameters);
    for (const word of ["urn:structured-exchange:3", "milestone", "finish-to-start", "start-to-finish", "never coordinates"]) {
      assert.ok(parameter.includes(word), `the document parameter does not mention ${word}`);
    }
  });

  test("TheAgentPresentsATimeline", async () => {
    const result = await present(project(), programme());
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.equal((result.details as { kind: string }).kind, "timeline");
    assert.match(result.content[0].text, /timeline 2026-10-01 to 2028-03-31: 4 tasks, 4 activities, 3 milestones, 4 dependencies/);
    assert.doesNotMatch(result.content[0].text, /not satisfied/);
  });

  test("TheAgentIsToldOfUnsatisfiedDependencies", async () => {
    const document = programme();
    // dev runs to 2027-09-30; CDR on 2027-08-01 cannot wait for it to finish.
    document.data.dependencies.push({ from: "dev", to: "cdr" });
    const result = await present(project(), document);
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.match(
      result.content[0].text,
      /not satisfied by the dates: "Critical Design Review" \(cdr\) waits on "Développement" \(dev\) \(finish-to-start\)/,
    );
  });

  test("ARefusedTimelineIsExplained", async () => {
    const document = programme();
    document.data.rows[2].items[0].start = "2027-10-31";
    const result = await present(project(), document);
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined, "a refused timeline reached the interface");
    assert.match(result.content[0].text, /inverted-range at \/data\/rows\/2\/items\/0/);
  });

  test("TimelineCarryingATargetIsRejected", async () => {
    const result = await present(project(), { ...programme(), target: { ref: "PLAN-1" } });
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined, "a refused timeline reached the interface");
    assert.match(result.content[0].text, /kind-not-proposable at \/target/);
  });

  test("a timeline presents unconstrained in a project with a default profile", async () => {
    const root = project({
      ".pi-outpost/structured-exchange.json": {
        schema: "urn:structured-exchange-profile-registry:1",
        profiles: ["profiles/requirements.json"],
        default: "acme/requirements",
      },
      "profiles/requirements.json": {
        schema: "urn:structured-exchange-profile:1",
        id: "acme/requirements",
        label: "ACME requirements",
        elementKinds: [{ kind: "requirement" }],
        relationshipKinds: [{ kind: "verifies" }],
      },
    });
    // The control: the same project does hold a graph to its default.
    const graph = await present(root, {
      schema: "urn:structured-exchange:3",
      kind: "graph",
      data: { nodes: [{ id: "a", label: "A", kind: "work-package" }], edges: [] },
    });
    assert.equal(graph.isError, true, "the default profile is not in force, so this proves nothing");

    const result = await present(root, programme());
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.equal((result.details as { kind: string }).kind, "timeline");
  });

  test("TheFigureWriterRefusesATimeline", async () => {
    const root = project({ "plan.json": programme() });
    mkdirSync(path.join(root, "figures"), { recursive: true });
    const tool = createStructuredExchangeFigureToolDefinition({
      cwd: root,
      allowedRoots: [root],
      maxBytes: 4_000_000,
      writableRoot: root,
      projectRoot: root,
    });
    const result = await (tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<ToolResult>)(
      "call-1",
      { path: "plan.json", output_path: "figures/plan.svg" },
      undefined,
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /timeline/);
    assert.match(result.content[0].text, /present_structure/);
    assert.doesNotMatch(result.content[0].text, /data rather than a drawing/);
    assert.equal(existsSync(path.join(root, "figures/plan.svg")), false);
  });

  test("the table writer refuses a timeline too, without sending the agent to the figure writer", async () => {
    const root = project({ "plan.json": programme() });
    const tool = createStructuredExchangeTableToolDefinition({
      cwd: root,
      allowedRoots: [root],
      maxBytes: 4_000_000,
      writableRoot: root,
      projectRoot: root,
    });
    const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", {
      path: "plan.json",
      output_path: "docs/plan.md",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /is a timeline, not a table/);
    assert.doesNotMatch(result.content[0].text, /write_structure_figure/);
    assert.equal(existsSync(path.join(root, "docs/plan.md")), false);
  });
});
