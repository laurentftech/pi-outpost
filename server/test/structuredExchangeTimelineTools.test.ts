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
import { createTimelineComparisonToolDefinition } from "../src/timelineComparisonTool.ts";
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

  const figureTool = (root: string) =>
    (createStructuredExchangeFigureToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 4_000_000, writableRoot: root, projectRoot: root })
      .execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<ToolResult>);

  test("TheAgentWritesATimelineFigure", async () => {
    const root = project({ "plan.json": programme() });
    const result = await figureTool(root)("call-1", { path: "plan.json", output_path: "figures/plan.svg", compact: true, width: 900 }, undefined);
    assert.notEqual(result.isError, true, result.content[0].text);
    const svg = readFileSync(path.join(root, "figures/plan.svg"), "utf8");
    assert.ok(svg.startsWith("<svg "));
    const width = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)![1]);
    assert.ok(width <= 900, `${width}`);
    assert.match(svg, /data-testid="timeline-section"/);
    // Dated, never "Today": the file outlives the day.
    assert.doesNotMatch(svg, />Today</);
    assert.match(result.content[0].text, /!\[plan\]\(figures\/plan\.svg\)/);
    assert.match(result.content[0].text, /items and \d+ dependencies/);
  });

  test("a timeline figure can leave the arrows and the date line out", async () => {
    const root = project({ "plan.json": programme() });
    const result = await figureTool(root)(
      "call-1",
      { path: "plan.json", output_path: "figures/bare.svg", hide_dependencies: true, reference_line: "none" },
      undefined,
    );
    assert.notEqual(result.isError, true, result.content[0].text);
    const svg = readFileSync(path.join(root, "figures/bare.svg"), "utf8");
    assert.doesNotMatch(svg, /timeline-dependency/);
    assert.doesNotMatch(svg, /timeline-today/);
    assert.match(result.content[0].text, /4 dependencies are not drawn/);
  });

  test("AnInvalidTimelineWritesNothing", async () => {
    const document = programme();
    document.data.rows[2].items[0].start = "2027-10-31";
    const root = project({ "plan.json": document });
    const result = await figureTool(root)("call-1", { path: "plan.json", output_path: "figures/plan.svg" }, undefined);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /inverted-range|start|end/);
    assert.equal(existsSync(path.join(root, "figures/plan.svg")), false);
  });

  test("a graph's narrowing asked of a timeline is refused, not ignored", async () => {
    const root = project({ "plan.json": programme() });
    const result = await figureTool(root)("call-1", { path: "plan.json", output_path: "figures/plan.svg", hide_element_kinds: ["SRR"] }, undefined);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /hide_element_kinds/);
    assert.equal(existsSync(path.join(root, "figures/plan.svg")), false);
  });

  test("TheTableWriterStillRefusesATimeline, without sending the agent to the figure writer", async () => {
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

  // ── Comparing two plans ─────────────────────────────────────────────────────

  /** The programme a few weeks later: SRR slipped three weeks, PDR dropped, a TRR added. */
  const later = () => {
    const document = programme();
    document.data.rows[1].items[1].date = "2027-03-22";
    document.data.rows[1].items.splice(3, 1);
    document.data.rows[1].items.push({ type: "milestone", id: "trr", date: "2027-10-15", kind: "TRR" });
    return document;
  };
  const compareTool = (root: string, writable: string | null = root) =>
    (createTimelineComparisonToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 4_000_000, writableRoot: writable })
      .execute as unknown as (id: string, params: unknown) => Promise<ToolResult>);

  test("compare_timelines presents the comparison and tells the agent what moved (TheAgentIsToldWhatMoved)", async () => {
    const root = project({ "plans/v1.json": programme(), "plans/v2.json": later() });
    const result = await compareTool(root)("call-1", { previous_path: "plans/v1.json", current_path: "plans/v2.json", label: "Plan of 1 September" });
    assert.notEqual(result.isError, true, result.content[0].text);
    const envelope = result.details as { kind: string; data: { comparedTo: { label: string }; rows: { type: string; items?: { id?: string; role?: string; previous?: unknown }[] }[] } };
    assert.equal(envelope.kind, "timeline");
    assert.equal(envelope.data.comparedTo.label, "Plan of 1 September");
    const items = envelope.data.rows[1].items!;
    assert.deepEqual(items.find((item) => item.id === "srr")!.previous, { date: "2027-03-01" });
    assert.equal(items.find((item) => item.id === "pdr")!.role, "removed");
    assert.equal(items.find((item) => item.id === "trr")!.role, "added");
    assert.match(result.content[0].text, /compared with "Plan of 1 September": 1 moved, 1 added, 1 removed; largest slip: "System Requirements Review" \+3 wk/);
    // T3's activity has no id in either plan.
    assert.match(result.content[0].text, /Not compared, for want of an `id`: 1 item of the current plan and 1 of the previous one/);
  });

  test("TheInputsStayPure", async () => {
    const root = project({ "plans/v1.json": programme(), "plans/v2.json": later() });
    const before = [readFileSync(path.join(root, "plans/v1.json"), "utf8"), readFileSync(path.join(root, "plans/v2.json"), "utf8")];
    const result = await compareTool(root)("call-1", { previous_path: "plans/v1.json", current_path: "plans/v2.json", output_path: "plans/v2-vs-v1.json" });
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.deepEqual([readFileSync(path.join(root, "plans/v1.json"), "utf8"), readFileSync(path.join(root, "plans/v2.json"), "utf8")], before);
    const written = JSON.parse(readFileSync(path.join(root, "plans/v2-vs-v1.json"), "utf8"));
    assert.equal(written.data.comparedTo.label, "Programme X");
    assert.deepEqual(written, result.details);
    // Never over an existing file.
    await assert.rejects(
      compareTool(root)("call-2", { previous_path: "plans/v1.json", current_path: "plans/v2.json", output_path: "plans/v2-vs-v1.json" }),
      /already exists/,
    );
  });

  test("the output stays inside the writable zone", async () => {
    const root = project({ "plans/v1.json": programme(), "plans/v2.json": later() });
    await assert.rejects(
      compareTool(root, null)("call-1", { previous_path: "plans/v1.json", current_path: "plans/v2.json", output_path: "out.json" }),
    );
    assert.equal(existsSync(path.join(root, "out.json")), false);
    await assert.rejects(compareTool(root)("call-1", { previous_path: "../elsewhere.json", current_path: "plans/v2.json" }), /outside the sandbox|No such file/);
  });

  test("AnInvalidInputIsRefused", async () => {
    const broken = programme();
    broken.data.rows[2].items[0].start = "2027-10-31";
    const root = project({ "plans/v1.json": broken, "plans/v2.json": later() });
    const result = await compareTool(root)("call-1", { previous_path: "plans/v1.json", current_path: "plans/v2.json", output_path: "plans/out.json" });
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined);
    assert.match(result.content[0].text, /inverted-range at \/data\/rows\/2\/items\/0/);
    assert.equal(existsSync(path.join(root, "plans/out.json")), false);
  });

  test("TheAgentWritesTheComparedVersion and TheAgentWritesTheNewVersion", async () => {
    const root = project({ "plans/v1.json": programme(), "plans/v2.json": later() });
    await compareTool(root)("call-1", { previous_path: "plans/v1.json", current_path: "plans/v2.json", output_path: "plans/cmp.json", label: "Plan of 1 September" });
    const compared = await figureTool(root)("call-2", { path: "plans/cmp.json", output_path: "figures/cmp.svg" }, undefined);
    assert.notEqual(compared.isError, true, compared.content[0].text);
    const comparedSvg = readFileSync(path.join(root, "figures/cmp.svg"), "utf8");
    assert.match(comparedSvg, /data-previous="true"/);
    assert.match(comparedSvg, />Compared with Plan of 1 September</);
    assert.match(comparedSvg, /\+3 wk/);
    const fresh = await figureTool(root)("call-3", { path: "plans/cmp.json", output_path: "figures/new.svg", comparison: "new" }, undefined);
    assert.notEqual(fresh.isError, true, fresh.content[0].text);
    const newSvg = readFileSync(path.join(root, "figures/new.svg"), "utf8");
    assert.doesNotMatch(newSvg, /data-previous|Compared with|\+3 wk|line-through/);
  });
});
