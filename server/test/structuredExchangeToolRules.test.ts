/**
 * The agent's tools in a project whose profile carries rules.
 *
 * Driven as the agent calls them, against real projects on disk: the refusal text the
 * agent reads, what reaches the interface's channel, and whether a figure file exists
 * afterwards are the whole interface here.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";
import { realResolve } from "../src/sandbox.ts";

type ToolResult = { content: { text: string }[]; details?: unknown; isError?: boolean };

const profile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "category", type: "enumeration", values: ["derived", "refined", "direct"], closed: true },
        { name: "safety", type: "enumeration", values: ["yes", "no"], closed: true },
        { name: "verification", type: "enumeration", values: ["test", "analysis", "review"], closed: true },
      ],
    },
  ],
  relationshipKinds: [{ kind: "satisfies" }],
};

const forbidDerived = {
  id: "ARP4754A-derived-no-satisfy",
  source: "ARP4754A",
  statement: "Une exigence dérivée ne satisfait pas une exigence amont.",
  level: "refuse",
  relationship: "satisfies",
  when: { from: { category: ["derived"] } },
  then: "forbidden",
};
const safetyBySafety = {
  id: "SAF-satisfied-by-safety",
  statement: "Une exigence safety n'est satisfaite que par des exigences safety.",
  level: "refuse",
  relationship: "satisfies",
  when: { to: { safety: ["yes"] } },
  then: { from: { safety: ["yes"] } },
};
const derivedVerification = {
  id: "CAT-derived-verification",
  statement: "Une exigence dérivée se vérifie par analyse ou revue.",
  level: "report",
  element: "requirement",
  when: { category: ["derived"] },
  then: { verification: ["analysis", "review"] },
};

const rulesFile = (rules: unknown[], profileId = "acme/requirements") => ({ schema: "urn:structured-exchange-rules:1", profile: profileId, rules });

type Row = { id: string; attributes?: Record<string, unknown> };
const table = (rows: Row[], relations: { from: Record<string, string>; to: Record<string, string> }[] = []) => ({
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  data: {
    columns: ["id"],
    rows: rows.map((row) => ({ id: row.id, kind: "requirement", cells: [row.id], ...(row.attributes ? { attributes: row.attributes } : {}) })),
    ...(relations.length === 0 ? {} : { relations: relations.map((relation) => ({ ...relation, kind: "satisfies" })) }),
  },
});

const derivedSatisfiesUpstream = () =>
  table([{ id: "req-1", attributes: { category: "derived", verification: "review" } }, { id: "req-2" }], [{ from: { id: "req-1" }, to: { id: "req-2" } }]);

describe("the agent's tools with project rules", () => {
  let base: string;
  let counter = 0;

  function project(rules: unknown[] | string, extra: Record<string, unknown> = {}): string {
    const root = path.join(base, `project-${counter++}`);
    const files: Record<string, unknown> = {
      ".pi-outpost/structured-exchange.json": { schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"], rules: ["rules/project.json"] },
      "profiles/requirements.json": profile,
      "rules/project.json": typeof rules === "string" ? rules : rulesFile(rules),
      ...extra,
    };
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return root;
  }

  const present = (projectRoot: string, document: unknown) =>
    (createStructuredExchangeToolDefinition({ projectRoot }).execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", {
      document: JSON.stringify(document),
      summary: "Requirements.",
    });

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-tool-rules-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("a violated refuse rule refuses the document with its identifier, statement and source, presenting nothing", async () => {
    // ARefuseRuleRefusesTheDocument, RegisteredRulesApplyToTheirProfile
    const result = await present(project([forbidDerived]), derivedSatisfiesUpstream());
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined, "a refused document reached the interface");
    assert.match(result.content[0].text, /rule\/ARP4754A-derived-no-satisfy at \/data\/relations\/0/);
    assert.match(result.content[0].text, /Une exigence dérivée ne satisfait pas une exigence amont\./);
    assert.match(result.content[0].text, /\(ARP4754A\)/);
    assert.match(result.content[0].text, /req-1 -satisfies-> req-2/);
  });

  test("a violated report rule is listed as a finding to check, and the document is presented", async () => {
    // AReportRuleIsListedButDoesNotRefuse
    const result = await present(project([derivedVerification]), table([{ id: "req-1", attributes: { category: "derived", verification: "test" } }]));
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.ok(result.details, "the document was not presented");
    assert.match(result.content[0].text, /with 1 finding to check/);
    assert.match(result.content[0].text, /\/data\/rows\/0 \(report rule violated\): rule "CAT-derived-verification": Une exigence dérivée se vérifie par analyse ou revue\./);
  });

  test("a rule not verifiable here is listed, never refused", async () => {
    const result = await present(project([safetyBySafety]), table([{ id: "req-1", attributes: { safety: "no" } }], [{ from: { id: "req-1" }, to: { ref: "REQ-99" } }]));
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.match(result.content[0].text, /\(not verifiable here\)/);
  });

  test("the vocabulary is checked before the rules, which apply once it is fixed", async () => {
    // VocabularyIsCheckedBeforeRules
    const root = project([forbidDerived]);
    const stray = derivedSatisfiesUpstream();
    stray.data.rows[1] = { ...stray.data.rows[1], attributes: { safety: "maybe" } };
    const first = await present(root, stray);
    assert.equal(first.isError, true);
    assert.match(first.content[0].text, /profile\/closed-enumeration/);
    assert.doesNotMatch(first.content[0].text, /rule\//, "a rule was applied to a document whose vocabulary strays");

    const second = await present(root, derivedSatisfiesUpstream());
    assert.equal(second.isError, true);
    assert.match(second.content[0].text, /rule\/ARP4754A-derived-no-satisfy/);
  });

  test("a figure of a document violating a refuse rule is not drawn, and nothing is written", async () => {
    const root = project([forbidDerived]);
    const graph = {
      schema: "urn:structured-exchange:2",
      kind: "graph",
      profile: "acme/requirements",
      data: {
        nodes: [
          { id: "a", label: "A", kind: "requirement", attributes: { category: "derived" } },
          { id: "b", label: "B", kind: "requirement" },
        ],
        edges: [{ from: "a", to: "b", kind: "satisfies" }],
      },
    };
    writeFileSync(path.join(root, "model.json"), JSON.stringify(graph));
    const tool = createStructuredExchangeFigureToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 4_000_000, writableRoot: root, projectRoot: root });
    const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", { path: "model.json", output_path: "figures/model.svg" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /rule\/ARP4754A-derived-no-satisfy at \/data\/edges\/0/);
    assert.equal(existsSync(path.join(root, "figures/model.svg")), false);
  });

  test("a rules file inconsistent with its profile refuses every document, naming the file", async () => {
    // ARulesFileInconsistentWithItsProfileRefusesEveryDocument
    const root = project([{ ...forbidDerived, when: { from: { category: ["derivee"] } } }]);
    const result = await present(root, table([{ id: "req-1" }]));
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined);
    assert.match(result.content[0].text, /rules-format\/undeclared-value in rules\/project\.json at \/rules\/0\/when\/from\/category\/0/);
  });

  test("a rules file for an unregistered profile refuses every document, naming the rules file", async () => {
    // ARulesFileForAnUnregisteredProfileRefusesEveryDocument
    const root = project(JSON.stringify(rulesFile([forbidDerived], "acme/other")));
    const result = await present(root, table([{ id: "req-1" }]));
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /registry\/rules-for-unregistered-profile/);
    assert.match(result.content[0].text, /rules\/project\.json/);
  });

  test("an edited rules file applies to the next call of the same tool", async () => {
    // AnEditedRulesFileAppliesToTheNextCheck
    const root = project([forbidDerived]);
    const tool = createStructuredExchangeToolDefinition({ projectRoot: root });
    const call = () =>
      (tool.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", {
        document: JSON.stringify(derivedSatisfiesUpstream()),
        summary: "Requirements.",
      });
    assert.equal((await call()).isError, true);
    writeFileSync(path.join(root, "rules/project.json"), JSON.stringify(rulesFile([safetyBySafety])));
    const again = await call();
    assert.notEqual(again.isError, true, again.content[0].text);
    assert.ok(again.details);
  });
});
