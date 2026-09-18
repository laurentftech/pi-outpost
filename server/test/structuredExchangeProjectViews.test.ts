/**
 * The rules register and the rule patterns, generated from a project's profile and rules.
 *
 * Read back as a reviewer reads them: the rows and cells of the register, the frames,
 * elements and relationships of the patterns. Every view that is produced is checked against
 * the core contract here too — a view the reader cannot render is not a view.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProfileRule, StructuredExchangeProfile } from "@pi-outpost/shared/structured-exchange/profile";
import { rulesListing } from "@pi-outpost/shared/structured-exchange/profile";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { holdToProfile } from "@pi-outpost/shared/structured-exchange/profile-check";
import {
  RULES_REGISTER_COLUMNS,
  rulePatterns,
  rulesRegister,
  selectViewProfile,
  type ProjectView,
} from "@pi-outpost/shared/structured-exchange/project-views";

const profile: StructuredExchangeProfile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: ["draft", "approved", "withdrawn"], closed: true, required: true },
        { name: "category", type: "enumeration", values: ["derived", "refined", "direct"], closed: true },
        { name: "safety", type: "enumeration", values: ["yes", "no"], closed: true },
        { name: "owner", type: "string" },
      ],
    },
    { kind: "test" },
  ],
  relationshipKinds: [
    { kind: "satisfies", from: ["requirement"], to: ["requirement"] },
    { kind: "verifies", from: ["test"], to: ["requirement"] },
    { kind: "traces" },
  ],
};

const rules: ProfileRule[] = [
  { id: "SAF-approved", statement: "A safety requirement is approved.", level: "report", element: "requirement", when: { safety: ["yes"] }, then: { status: ["approved"] } },
  { id: "ARP-derived", source: "ARP4754A", statement: "A derived requirement does not satisfy an upstream one.", level: "refuse", relationship: "satisfies", when: { from: { category: ["derived"] } }, then: "forbidden" },
  { id: "CAT-choice", statement: "A derived or refined safety requirement has an owner category.", level: "report", element: "requirement", when: { category: ["derived", "refined"], safety: ["yes"] }, then: { owner: ["systems"] } },
  { id: "SAF-by-safety", statement: "A safety requirement is satisfied only by safety requirements.", level: "refuse", relationship: "satisfies", when: { to: { safety: ["yes"] } }, then: { from: { safety: ["yes"] } } },
];

const sources = [
  { path: "profiles/requirements.json", sha256: `sha256:${"a".repeat(64)}` },
  { path: "rules/review.json", sha256: `sha256:${"b".repeat(64)}` },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
function produced(view: ProjectView): any {
  assert.ok("document" in view, "refused" in view ? view.refused : "no document");
  const verdict = parseStructuredExchange(view.document, checkStructuredExchangeSchema);
  assert.ok(verdict.valid, `the view breaks the contract: ${JSON.stringify(verdict.valid ? [] : verdict.issues)}`);
  return view.document;
}

describe("the rules register", () => {
  const register = () => produced(rulesRegister(profile, rules, sources));
  /** Rows as `heading` or `id` lines, in order. */
  const outline = (table: any) =>
    table.data.rows.map((row: any) => (row.heading !== undefined ? `# ${row.heading}` : row.id)) as string[];
  const cellsOf = (table: any, id: string) => {
    const row = table.data.rows.find((each: any) => each.id === id);
    assert.ok(row, `${id} is not in the register`);
    return Object.fromEntries(RULES_REGISTER_COLUMNS.map((column, index) => [column, row.cells[index]]));
  };

  test("groups rules by the kind they target, element kinds first, each in the registry's order", () => {
    // RulesAreGroupedByTheKindTheyTarget
    assert.deepEqual(outline(register()), [
      "# Rules of acme/requirements — ACME requirements",
      "# element kind requirement",
      "SAF-approved",
      "CAT-choice",
      "# relationship kind satisfies",
      "ARP-derived",
      "SAF-by-safety",
    ]);
  });

  test("reads conditions as they are checked: values as alternatives, attributes all holding, ends labelled", () => {
    // ConditionsReadAsTheyAreChecked
    const table = register();
    assert.equal(cellsOf(table, "CAT-choice").when, 'category ∈ {"derived", "refined"} and safety ∈ {"yes"}');
    assert.equal(cellsOf(table, "SAF-by-safety").when, 'target safety ∈ {"yes"}');
    assert.equal(cellsOf(table, "SAF-by-safety").then, 'source safety ∈ {"yes"}');
    assert.equal(cellsOf(table, "SAF-approved")["applies to"], "element requirement");
    assert.equal(cellsOf(table, "ARP-derived")["applies to"], "relationship satisfies");
    assert.equal(cellsOf(table, "ARP-derived").source, "ARP4754A");
    assert.equal(cellsOf(table, "SAF-approved").source, null);
    assert.equal(cellsOf(table, "SAF-approved").level, "report");
    assert.equal(cellsOf(table, "SAF-approved").statement, "A safety requirement is approved.");
  });

  test("names the attributes a rule selects on, by end for a link rule", () => {
    // TheAttributesARuleSelectsOnAreNamed
    const table = register();
    assert.equal(cellsOf(table, "SAF-by-safety")["not selected without"], "target safety");
    assert.equal(cellsOf(table, "CAT-choice")["not selected without"], "category, safety");
    const always: ProfileRule = { id: "ALL", statement: "Every requirement is approved.", level: "report", element: "requirement", then: { status: ["approved"] } };
    const withAlways = produced(rulesRegister(profile, [always], sources));
    assert.equal(cellsOf(withAlways, "ALL")["not selected without"], null);
    assert.equal(cellsOf(withAlways, "ALL").when, "always");
  });

  test("reads a forbidding rule as forbidden", () => {
    // AForbiddingRuleReadsAsForbidden
    assert.equal(cellsOf(register(), "ARP-derived").then, "forbidden");
  });

  test("records the files it was generated from, with their digests", () => {
    // TheRegisterRecordsItsSources
    assert.deepEqual(register().artifacts, [
      { rel: "generatedFrom", uri: "profiles/requirements.json", sha256: `sha256:${"a".repeat(64)}` },
      { rel: "generatedFrom", uri: "rules/review.json", sha256: `sha256:${"b".repeat(64)}` },
    ]);
  });

  test("is the same document when generated twice from unchanged files", () => {
    // TheRegisterIsReproducible
    assert.equal(JSON.stringify(register()), JSON.stringify(register()));
  });

  test("says so when the profile has no rules", () => {
    // AProfileWithoutRulesSaysSo
    const table = produced(rulesRegister(profile, [], sources.slice(0, 1)));
    assert.deepEqual(outline(table), ["# Rules of acme/requirements — ACME requirements", "# No rules: no rules file names this profile"]);
  });

  test("is a version 2 table naming the reserved identifier, which no project's default holds", () => {
    // TheRegisterIsAValidTable
    const table = register();
    assert.equal(table.schema, "urn:structured-exchange:2");
    assert.equal(table.kind, "table");
    assert.equal(table.profile, "urn:structured-exchange-rules-register:1");
    assert.deepEqual(holdToProfile(table, { profiles: new Map([[profile.id, profile]]), default: profile.id }), { outcome: "unconstrained" });
  });

  test("is refused, saying why, when it does not fit the contract", () => {
    const long: ProfileRule = { ...rules[0], id: "LONG", statement: "x".repeat(1500) };
    const view = rulesRegister(profile, [long], sources);
    assert.ok("refused" in view);
    assert.match(view.refused, /rules register does not fit the structured-exchange contract/);
  });

  test("leaves the text listing the validator prints unchanged", () => {
    assert.equal(
      rulesListing(profile.id, [rules[3]]),
      [
        "Rules for acme/requirements: 1",
        "",
        "  SAF-by-safety — refuse",
        "    A safety requirement is satisfied only by safety requirements.",
        "    applies to: relationship satisfies",
        '    when: target safety ∈ {"yes"}',
        '    then: source safety ∈ {"yes"}',
        "",
      ].join("\n"),
    );
  });
});

describe("the rule patterns", () => {
  const patterns = () => produced(rulePatterns(profile, rules, sources));
  const containerOf = (graph: any, n: number) => graph.data.containers.find((each: any) => each.id === `rule-${n}`);
  const inContainer = (graph: any, n: number) =>
    graph.data.nodes.filter((node: any) => node.container === `rule-${n}`).map((node: any) => `${node.kind}: ${node.label}`) as string[];
  const edgesIn = (graph: any, n: number) =>
    graph.data.edges.filter((edge: any) => edge.from.startsWith(`rule-${n}-`)).map((edge: any) => `${edge.from} -[${edge.kind} / ${edge.label}]-> ${edge.to}`) as string[];

  test("draws a link rule between its ends, typed by the kinds they allow and what selects them, forbidden where it is", () => {
    // ALinkRuleIsDrawnBetweenItsTypedEnds
    const graph = patterns();
    assert.deepEqual(containerOf(graph, 2), {
      id: "rule-2",
      label: "REFUSE · ARP-derived — A derived requirement does not satisfy an upstream one.",
      kind: "refuse rule",
    });
    assert.deepEqual(inContainer(graph, 2), ["selects: requirement · when category = derived", "any: requirement"]);
    assert.deepEqual(edgesIn(graph, 2), ["rule-2-from -[satisfies (forbidden) / satisfies ✗ forbidden]-> rule-2-to"]);
  });

  test("shows what an end must have apart from what selects the other", () => {
    // WhatAnEndMustHaveIsShownApartFromWhatSelectsIt
    const graph = patterns();
    assert.deepEqual(inContainer(graph, 4), ["must hold: requirement · must have safety = yes", "selects: requirement · when safety = yes"]);
    assert.deepEqual(edgesIn(graph, 4), ["rule-4-from -[satisfies / satisfies]-> rule-4-to"]);
    assert.equal(containerOf(graph, 4).kind, "refuse rule");
  });

  test("shows an end its relationship kind leaves open as any element kind, guessing none", () => {
    // AnUndeclaredEndIsShownAsAnyKind
    const traced: ProfileRule = { id: "TRC", statement: "Only a direct requirement is traced.", level: "report", relationship: "traces", then: { from: { category: ["direct"] } } };
    const graph = produced(rulePatterns(profile, [traced], sources));
    assert.deepEqual(inContainer(graph, 1), ["must hold: any element kind · must have category = direct", "any: any element kind"]);
    const verified: ProfileRule = { id: "VER", statement: "A test verifies a safety requirement.", level: "report", relationship: "verifies", then: { to: { safety: ["yes"] } } };
    assert.deepEqual(inContainer(produced(rulePatterns(profile, [verified], sources)), 1), ["any: test", "must hold: requirement · must have safety = yes"]);
  });

  test("draws an item rule as one element with what selects it and what it must have", () => {
    // AnItemRuleIsOneElement
    const graph = patterns();
    assert.deepEqual(inContainer(graph, 1), ["selected item: requirement · when safety = yes · must have status = approved"]);
    assert.deepEqual(inContainer(graph, 3), ["selected item: requirement · when category = derived | refined, safety = yes · must have owner = systems"]);
    assert.deepEqual(edgesIn(graph, 1), []);
    const forbidden: ProfileRule = { id: "NO-WD", statement: "No withdrawn requirement.", level: "refuse", element: "requirement", when: { status: ["withdrawn"] }, then: "forbidden" };
    assert.deepEqual(inContainer(produced(rulePatterns(profile, [forbidden], sources)), 1), ["forbidden item: requirement · when status = withdrawn · forbidden"]);
  });

  test("shortens a long statement in the label only, and still draws the rule", () => {
    // ALongStatementIsShortenedOnlyInTheLabel
    const long: ProfileRule = { ...rules[0], id: "LONG", statement: "Une exigence safety est approuvée ".repeat(40).trim() };
    const graph = produced(rulePatterns(profile, [long], sources));
    const label = containerOf(graph, 1).label as string;
    assert.ok(label.length <= 500, `${label.length}`);
    assert.ok(label.startsWith("REPORT · LONG — Une exigence safety est approuvée"));
    assert.ok(label.endsWith("…"));
  });

  test("draws nothing for a profile without rules, and says so", () => {
    // AProfileWithoutRulesHasNoPatterns
    const view = rulePatterns(profile, [], sources);
    assert.ok("refused" in view);
    assert.match(view.refused, /profile "acme\/requirements" has no rules/);
  });

  test("refuses more rules than the contract allows frames, rather than drawing the first ones", () => {
    // TooManyRulesAreRefusedNotCut
    const many = Array.from({ length: 51 }, (_, index): ProfileRule => ({ ...rules[0], id: `R-${index}` }));
    const view = rulePatterns(profile, many, sources);
    assert.ok("refused" in view);
    assert.match(view.refused, /rule patterns does not fit the structured-exchange contract: .*containers.*limit 50/);
    assert.ok("document" in rulePatterns(profile, many.slice(0, 50), sources));
  });

  test("is the same document when generated twice from unchanged files", () => {
    // ThePatternsAreReproducible
    assert.equal(JSON.stringify(patterns()), JSON.stringify(patterns()));
  });

  test("is a version 2 graph naming the reserved identifier, with its sources, never held to a default", () => {
    // ThePatternsAreAValidGraph
    const graph = patterns();
    assert.equal(graph.kind, "graph");
    assert.equal(graph.profile, "urn:structured-exchange-rule-patterns:1");
    assert.deepEqual(graph.artifacts.map((artifact: any) => artifact.uri), ["profiles/requirements.json", "rules/review.json"]);
    assert.deepEqual(holdToProfile(graph, { profiles: new Map([[profile.id, profile]]), default: profile.id }), { outcome: "unconstrained" });
  });
});

describe("which profile a view is of", () => {
  const tests: StructuredExchangeProfile = { schema: "urn:structured-exchange-profile:1", id: "acme/tests", label: "Tests", elementKinds: [{ kind: "test" }] };
  const two = new Map([
    [profile.id, profile],
    [tests.id, tests],
  ]);

  test("the one named", () => {
    assert.deepEqual(selectViewProfile({ profiles: two }, "acme/tests"), { profile: tests });
  });

  test("else the default", () => {
    assert.deepEqual(selectViewProfile({ profiles: two, default: "acme/tests" }), { profile: tests });
  });

  test("else the only one registered", () => {
    assert.deepEqual(selectViewProfile({ profiles: new Map([[profile.id, profile]]) }), { profile });
  });

  test("with several and no default, none — listing them", () => {
    const choice = selectViewProfile({ profiles: two });
    assert.ok("refused" in choice);
    assert.match(choice.refused, /2 profiles and no default; name one of "acme\/requirements", "acme\/tests"/);
  });

  test("a name the registry does not register is refused, listing what is", () => {
    const choice = selectViewProfile({ profiles: two, default: "acme/tests" }, "acme/other");
    assert.ok("refused" in choice);
    assert.match(choice.refused, /no profile "acme\/other"; registered: "acme\/requirements", "acme\/tests"/);
  });
});
