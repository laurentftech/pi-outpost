/**
 * `present_project_model`, as the agent calls it, against real projects on disk.
 *
 * What the agent reads back and what reaches the interface's channel are the whole
 * contract, so the assertions are on the text and on `details` — and the files are edited
 * between calls to prove nothing is remembered.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createStructuredExchangeProjectModelToolDefinition } from "../src/structuredExchangeProjectModelTool.ts";
import { realResolve } from "../src/sandbox.ts";
import { structuredConformanceFor } from "../src/structuredExchangeProfiles.ts";

type ToolResult = { content: { text: string }[]; details?: Record<string, unknown>; isError?: boolean };

const profile = (id = "acme/requirements") => ({
  schema: "urn:structured-exchange-profile:1",
  id,
  label: "ACME requirements",
  elementKinds: [
    { kind: "requirement", attributes: [{ name: "category", type: "enumeration", values: ["derived", "direct"], closed: true }, { name: "safety", type: "enumeration", values: ["yes", "no"], closed: true }] },
    { kind: "test" },
  ],
  relationshipKinds: [{ kind: "satisfies", from: ["requirement"], to: ["requirement"] }, { kind: "verifies", from: ["test"], to: ["requirement"] }],
});

const rules = (statement = "A derived requirement does not satisfy an upstream one.") => ({
  schema: "urn:structured-exchange-rules:1",
  profile: "acme/requirements",
  rules: [
    { id: "ARP-derived", source: "ARP4754A", statement, level: "refuse", relationship: "satisfies", when: { from: { category: ["derived"] } }, then: "forbidden" },
    { id: "SAF-yes", statement: "A safety requirement is direct.", level: "report", element: "requirement", when: { safety: ["yes"] }, then: { category: ["direct"] } },
  ],
});

describe("present_project_model", () => {
  let base: string;
  let counter = 0;

  function project(files: Record<string, unknown>): string {
    const root = path.join(base, `project-${counter++}`);
    mkdirSync(root, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return root;
  }
  const registry = (extra: Record<string, unknown> = {}) => ({
    schema: "urn:structured-exchange-profile-registry:1",
    profiles: ["profiles/requirements.json"],
    rules: ["rules/review.json"],
    ...extra,
  });
  const standard = () =>
    project({ ".pi-outpost/structured-exchange.json": registry(), "profiles/requirements.json": profile(), "rules/review.json": rules() });

  const call = (projectRoot: string, params: Record<string, unknown>) =>
    (createStructuredExchangeProjectModelToolDefinition({ projectRoot }).execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)(
      "call-1",
      params,
    );

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-project-model-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("presents the rules register as a table", async () => {
    // TheAgentPresentsTheRulesRegister
    const result = await call(standard(), { view: "rules-register" });
    assert.notEqual(result.isError, true, result.content[0].text);
    const table = result.details as { kind: string; profile: string; data: { rows: { id?: string }[] } };
    assert.equal(table.kind, "table");
    assert.equal(table.profile, "urn:structured-exchange-rules-register:1");
    assert.deepEqual(table.data.rows.filter((row) => row.id !== undefined).map((row) => row.id), ["SAF-yes", "ARP-derived"]);
    assert.match(result.content[0].text, /^Presented the rules register of profile "acme\/requirements", generated from profiles\/requirements\.json, rules\/review\.json\./);
  });

  test("presents the rule patterns as a graph", async () => {
    // TheAgentPresentsTheRulePatterns
    const result = await call(standard(), { view: "rule-patterns" });
    assert.notEqual(result.isError, true, result.content[0].text);
    const graph = result.details as { kind: string; profile: string; data: { nodes: { label: string; container?: string }[]; containers: { label: string }[] } };
    assert.equal(graph.kind, "graph");
    assert.equal(graph.profile, "urn:structured-exchange-rule-patterns:1");
    assert.deepEqual(graph.data.containers.map((container) => container.label), [
      "REFUSE · ARP-derived — A derived requirement does not satisfy an upstream one.",
      "REPORT · SAF-yes — A safety requirement is direct.",
    ]);
    assert.deepEqual(graph.data.nodes.filter((node) => node.container === "rule-1").map((node) => node.label), ["requirement · when category = derived", "requirement"]);
    assert.match(result.content[0].text, /^Presented the rule patterns of profile "acme\/requirements"/);
  });

  test("gives the agent the listing of the profile and every rule, and asks for a person to confirm", async () => {
    // TheAgentReadsTheListing
    const text = (await call(standard(), { view: "rules-register" })).content[0].text;
    assert.match(text, /Profile acme\/requirements — ACME requirements/);
    assert.match(text, / {2}satisfies\n {4}source: requirement\n {4}target: requirement\n/);
    assert.match(text, / {2}ARP-derived — refuse — ARP4754A\n {4}A derived requirement does not satisfy an upstream one\.\n {4}applies to: relationship satisfies\n {4}when: source category ∈ \{"derived"\}\n {4}then: forbidden/);
    assert.match(text, / {2}SAF-yes — report\n {4}A safety requirement is direct\.\n {4}applies to: element requirement\n {4}when: safety ∈ \{"yes"\}\n {4}then: category ∈ \{"direct"\}/);
    assert.match(text, /do its conditions say what its statement says\? Then ask the user to confirm them/);
  });

  test("an unusable registry is reported issue by issue, and nothing is presented", async () => {
    // AnUnusableRegistryIsReportedIssueByIssue
    const broken = {
      ...rules(),
      rules: [
        { ...rules().rules[0], when: { from: { category: ["derivee"] } } },
        { ...rules().rules[1], then: { owner: ["systems"] } },
      ],
    };
    const root = project({ ".pi-outpost/structured-exchange.json": registry(), "profiles/requirements.json": profile(), "rules/review.json": broken });
    const result = await call(root, { view: "rule-patterns" });
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined);
    const text = result.content[0].text;
    assert.match(text, /registry cannot be used/);
    const found = [...text.matchAll(/^- (\S+) in (\S+) at (\S+):/gm)].map((match) => `${match[1]} in ${match[2]} at ${match[3]}`);
    assert.deepEqual(found, [
      "rules-format/undeclared-value in rules/review.json at /rules/0/when/from/category/0",
      "rules-format/undeclared-attribute in rules/review.json at /rules/1/then/owner",
    ]);
  });

  test("a rules file that invents its shape is answered with the shape to copy", async () => {
    // TheRuleFormIsGivenWhenARulesFileBreaksIt — the fields a model was seen inventing live
    const invented = {
      schema: "urn:structured-exchange-rules:1",
      profile: "acme/requirements",
      rules: [{ id: "arp", statement: "Une exigence dérivée ne satisfait pas une exigence amont.", level: "error", when: { relationshipKind: "satisfies" }, then: "forbidden", where: { from: { category: "derived" } } }],
    };
    const root = project({ ".pi-outpost/structured-exchange.json": registry(), "profiles/requirements.json": profile(), "rules/review.json": invented });
    const result = await call(root, { view: "rules-register" });
    assert.equal(result.isError, true);
    const text = result.content[0].text;
    assert.match(text, /rules-format\/schema\//);
    assert.match(text, /A rules file has this shape — copy it and change the words, do not invent fields:/);
    // The shape given is itself a valid rules file, once its placeholders are filled from the profile.
    const shown = JSON.parse(text.split("\n").find((line) => line.startsWith('{"schema":"urn:structured-exchange-rules:1"'))!);
    shown.profile = "acme/requirements";
    const { validateRules } = await import("@pi-outpost/shared/structured-exchange/rules-validation");
    assert.deepEqual(validateRules(shown).issues, []);
    assert.match(text, /\/skill:structured-exchange-project/);

    // A registry unusable for another reason is not lectured about rules.
    const other = project({ ".pi-outpost/structured-exchange.json": registry({ default: "acme/other" }), "profiles/requirements.json": profile(), "rules/review.json": rules() });
    assert.doesNotMatch((await call(other, { view: "rules-register" })).content[0].text, /has this shape/);
  });

  test("a project without a registry is told where the registry goes", async () => {
    // AProjectWithoutARegistryIsToldWhereItGoes
    const result = await call(project({ "README.md": "nothing here" }), { view: "rules-register" });
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined);
    assert.match(result.content[0].text, /no structured-exchange registry/);
    assert.match(result.content[0].text, /\.pi-outpost\/structured-exchange\.json/);
    assert.match(result.content[0].text, /structured-exchange-project skill/);
  });

  test("with several profiles and no default, one must be named", async () => {
    // SeveralProfilesNeedOneNamed
    const root = project({
      ".pi-outpost/structured-exchange.json": registry({ profiles: ["profiles/requirements.json", "profiles/tests.json"] }),
      "profiles/requirements.json": profile(),
      "profiles/tests.json": { ...profile("acme/tests"), relationshipKinds: [] },
      "rules/review.json": rules(),
    });
    const unnamed = await call(root, { view: "rules-register" });
    assert.equal(unnamed.isError, true);
    assert.equal(unnamed.details, undefined);
    assert.match(unnamed.content[0].text, /name one of "acme\/requirements", "acme\/tests"/);
    const named = await call(root, { view: "rules-register", profile: "acme/tests" });
    assert.notEqual(named.isError, true, named.content[0].text);
    assert.match(named.content[0].text, /generated from profiles\/tests\.json\./);
    const unknown = await call(root, { view: "rules-register", profile: "acme/other" });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /no profile "acme\/other"; registered: "acme\/requirements", "acme\/tests"/);
  });

  test("an edited rules file is presented as it is now, with nothing restarted", async () => {
    // AnEditedRulesFileIsPresentedAsItIsNow
    const root = standard();
    const tool = createStructuredExchangeProjectModelToolDefinition({ projectRoot: root });
    const run = (params: unknown) => (tool.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("c", params);
    const statementOf = (result: ToolResult) =>
      ((result.details as { data: { rows: { id?: string; cells?: unknown[] }[] } }).data.rows.find((row) => row.id === "ARP-derived")?.cells ?? [])[5];
    assert.equal(statementOf(await run({ view: "rules-register" })), "A derived requirement does not satisfy an upstream one.");
    writeFileSync(path.join(root, "rules/review.json"), JSON.stringify(rules("Une exigence dérivée ne satisfait pas une exigence amont.")));
    assert.equal(statementOf(await run({ view: "rules-register" })), "Une exigence dérivée ne satisfait pas une exigence amont.");
  });

  test("a view is never held to the project's default profile and carries no conformance statement", async () => {
    // AViewIsNeverHeldToTheProjectsProfile
    const root = project({
      ".pi-outpost/structured-exchange.json": registry({ default: "acme/requirements" }),
      "profiles/requirements.json": profile(),
      "rules/review.json": rules(),
    });
    const presented: { toolCallId: string; structured: string }[] = [];
    for (const view of ["rules-register", "rule-patterns"]) {
      const result = await call(root, { view });
      assert.notEqual(result.isError, true, result.content[0].text);
      presented.push({ toolCallId: view, structured: JSON.stringify(result.details) });
    }
    assert.deepEqual(await structuredConformanceFor(root, presented), []);
    // Nor once the registry breaks: a view restored then is not "could not be checked" —
    // it never was checked against a profile. Found at the bench.
    writeFileSync(path.join(root, ".pi-outpost/structured-exchange.json"), "{ not json");
    assert.deepEqual(await structuredConformanceFor(root, presented), []);
  });

  test("writes nothing", async () => {
    const root = standard();
    const before = readdirSync(root, { recursive: true }).sort();
    await call(root, { view: "rules-register" });
    await call(root, { view: "rule-patterns" });
    assert.deepEqual(readdirSync(root, { recursive: true }).sort(), before);
  });
});
