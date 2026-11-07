/**
 * The structured-exchange contract.
 *
 * The schema file is the normative artifact, so what is tested here is that the
 * code around it cannot quietly disagree with it: the mirrored ceilings, the
 * conditional-required rules that make patch semantics expressible, and the
 * shape a producer is entitled to rely on.
 *
 * These live under server/ rather than shared/ for a blunt reason: CI runs the
 * server and ui test suites and nothing else, so a suite in shared/ would be a
 * suite nobody runs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { Check } from "typebox/value";
import { STRUCTURED_EXCHANGE_CEILINGS, STRUCTURED_EXCHANGE_SCHEMA_V1, PROPOSABLE_KINDS, type StructuredExchangeEnvelope } from "@pi-outpost/shared/structured-exchange";
import { structuredExchangeField } from "../src/convert.ts";
import { validateStructuredExchangeSemantics } from "@pi-outpost/shared/structured-exchange/validation";

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../shared/schemas/structured-exchange-1.json",
);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

/** The three data variants, by the property that identifies each. */
const [graphVariant, sequenceVariant, tableVariant] = schema.properties.data.oneOf;

/** A minimal valid envelope of each kind, for tests that vary one thing. */
const graph = (over: Record<string, unknown> = {}) => ({
  schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
  kind: "graph",
  data: { nodes: [{ id: "a", label: "A" }], edges: [] },
  ...over,
});

describe("structured-exchange schema", () => {
  test("declares the version-1 identifier as its own constant", () => {
    assert.equal(schema.$id, STRUCTURED_EXCHANGE_SCHEMA_V1);
    assert.equal(schema.properties.schema.const, STRUCTURED_EXCHANGE_SCHEMA_V1);
  });

  test("refuses anything it did not declare", () => {
    assert.equal(schema.additionalProperties, false);
    assert.equal(Check(schema, graph({ unexpected: 1 })), false);
  });

  test("requires only what a document cannot do without", () => {
    assert.deepEqual(schema.required, ["schema", "kind", "data"]);
    // target and removals are what make a document a proposal; neither is required
    assert.equal(Check(schema, graph()), true);
  });

  // -------------------------------------------------------------------------
  // Ceilings: mirrored in code, and the mirror must not drift
  // -------------------------------------------------------------------------
  describe("ceilings", () => {
    const collections: [keyof typeof STRUCTURED_EXCHANGE_CEILINGS, unknown][] = [
      ["nodes", graphVariant.properties.nodes.maxItems],
      ["edges", graphVariant.properties.edges.maxItems],
      ["participants", sequenceVariant.properties.participants.maxItems],
      ["messages", sequenceVariant.properties.messages.maxItems],
      ["columns", tableVariant.properties.columns.maxItems],
      ["rows", tableVariant.properties.rows.maxItems],
      ["removals", schema.properties.removals.maxItems],
    ];

    for (const [name, declared] of collections) {
      test(`${name} matches the schema`, () => {
        assert.equal(STRUCTURED_EXCHANGE_CEILINGS[name], declared, `${name} ceiling drifted from the schema`);
      });
    }

    const strings: [keyof typeof STRUCTURED_EXCHANGE_CEILINGS, unknown][] = [
      ["ref", schema.$defs.ref.maxLength],
      ["localId", schema.$defs.localId.maxLength],
      ["label", schema.$defs.label.maxLength],
      ["kind", schema.$defs.kind.maxLength],
      ["columnName", tableVariant.properties.columns.items.maxLength],
      // A row is either a bare array of cells or an object carrying them, so the
      // cell bound lives in the definition both forms point at.
      ["cell", schema.$defs.cells.items.maxLength],
    ];

    for (const [name, declared] of strings) {
      test(`${name} length matches the schema`, () => {
        assert.equal(STRUCTURED_EXCHANGE_CEILINGS[name], declared, `${name} ceiling drifted from the schema`);
      });
    }

    test("every collection and string in the schema is bounded", () => {
      // Walks the schema rather than listing what to check, so a collection added
      // later without a bound fails here instead of shipping unbounded.
      const unbounded: string[] = [];
      const walk = (node: unknown, at: string) => {
        if (node === null || typeof node !== "object") return;
        const it = node as Record<string, unknown>;
        if (it.type === "array" && it.maxItems === undefined) unbounded.push(`${at} (array)`);
        if (it.type === "string" && it.maxLength === undefined && it.const === undefined && it.enum === undefined) {
          unbounded.push(`${at} (string)`);
        }
        for (const [key, value] of Object.entries(it)) walk(value, `${at}/${key}`);
      };
      walk(schema, "#");
      assert.deepEqual(unbounded, [], `unbounded: ${unbounded.join(", ")}`);
    });
  });

  // -------------------------------------------------------------------------
  // Patch semantics, as far as the schema can express them
  // -------------------------------------------------------------------------
  describe("patch semantics", () => {
    test("a new element must declare its label", () => {
      assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a" }], edges: [] } })), false);
      assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a", label: "A" }], edges: [] } })), true);
    });

    test("a referenced element may declare nothing else, and is then context", () => {
      assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a", ref: "R" }], edges: [] } })), true);
    });

    test("an element and a relationship share one definition of a type", () => {
      // Two definitions of the same idea drift. A reader colours by this field on
      // both, so they have to mean the same thing and be bounded the same way.
      assert.deepEqual(schema.$defs.element.properties.kind, { $ref: "#/$defs/kind" });
      assert.deepEqual(schema.$defs.edge.properties.kind, { $ref: "#/$defs/kind" });
    });

    test("an element may declare its type, and a patch may retype it", () => {
      const typed = { id: "a", label: "A", kind: "block" };
      assert.equal(Check(schema, graph({ data: { nodes: [typed], edges: [] } })), true);
      assert.equal(
        Check(schema, graph({ data: { nodes: [{ id: "a", ref: "R", set: { kind: "sensor" } }], edges: [] } })),
        true,
      );
      // Still opaque: no enumeration, any non-empty domain vocabulary goes through
      assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a", label: "A", kind: "«subsystem»" }], edges: [] } })), true);
      assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a", label: "A", kind: "" }], edges: [] } })), false);
    });

    test("a referenced element may patch just its label", () => {
      assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a", ref: "R", label: "renamed" }], edges: [] } })), true);
    });

    test("a new relationship must declare its kind, a referenced one need not", () => {
      const nodes = [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ];
      assert.equal(Check(schema, graph({ data: { nodes, edges: [{ from: "a", to: "b" }] } })), false);
      assert.equal(Check(schema, graph({ data: { nodes, edges: [{ from: "a", to: "b", kind: "k" }] } })), true);
      assert.equal(Check(schema, graph({ data: { nodes, edges: [{ from: "a", to: "b", ref: "R" }] } })), true);
    });

    test("a relationship always declares its endpoints, referenced or not", () => {
      // Endpoints are identity, not state: even a patch restates them, so the
      // approval view can always place what it shows.
      const nodes = [{ id: "a", label: "A" }];
      assert.equal(Check(schema, graph({ data: { nodes, edges: [{ ref: "R", label: "renamed" }] } })), false);
    });
  });

  // -------------------------------------------------------------------------
  // Removals
  // -------------------------------------------------------------------------
  describe("removals", () => {
    test("say what kind of thing they name", () => {
      assert.equal(Check(schema, graph({ target: "T", removals: [{ ref: "R" }] })), false);
      assert.equal(Check(schema, graph({ target: "T", removals: [{ type: "element", ref: "R" }] })), true);
      assert.equal(Check(schema, graph({ target: "T", removals: [{ type: "relationship", ref: "R" }] })), true);
    });

    test("refuse a kind of thing that is not one of the two", () => {
      assert.equal(Check(schema, graph({ target: "T", removals: [{ type: "attribute", ref: "R" }] })), false);
    });
  });

  // -------------------------------------------------------------------------
  // Kinds
  // -------------------------------------------------------------------------
  describe("kinds", () => {
    test("only graph and sequence may be proposed", () => {
      assert.deepEqual([...PROPOSABLE_KINDS], ["graph", "sequence"]);
      assert.deepEqual(schema.properties.kind.enum, ["graph", "sequence", "table"]);
    });

    /**
     * Roles report; they do not propose. A table stays unapplicable whatever its
     * rows declare, and the older row form has to keep working for the life of
     * version 1 — a producer written before roles existed sends bare arrays.
     */
    describe("a table's rows may report a change without becoming a proposal", () => {
      const table = (rows: unknown[], over: Record<string, unknown> = {}) => ({
        schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
        kind: "table",
        data: { columns: ["id", "requirement"], rows },
        ...over,
      });

      test("both row forms are accepted, mixed in one table", () => {
        assert.equal(
          Check(
            schema,
            table([
              ["REQ-1", "a bare row"],
              { cells: ["REQ-2", "a row that declares nothing"] },
              { role: "added", cells: ["REQ-3", "a row that declares a role"] },
            ]),
          ),
          true,
        );
      });

      test("every declared role is a role the renderer knows", () => {
        for (const role of ["added", "changed", "context", "removed"]) {
          assert.equal(Check(schema, table([{ role, cells: ["REQ-1", "x"] }])), true, role);
        }
        assert.equal(Check(schema, table([{ role: "deleted", cells: ["REQ-1", "x"] }])), false);
      });

      test("a row object without cells is not a row", () => {
        assert.equal(Check(schema, table([{ role: "added" }])), false);
      });

      test("either form must align to the declared columns", () => {
        const short = validateStructuredExchangeSemantics(
          table([{ role: "added", cells: ["only-one"] }]) as never,
        );
        assert.deepEqual(
          short.map((issue) => [issue.rule, issue.path, issue.observed, issue.limit]),
          [["row-column-mismatch", "/data/rows/0", 1, 2]],
        );
        // The bare form reports the same way, so a producer reads one message
        const bare = validateStructuredExchangeSemantics(table([["only-one"]]) as never);
        assert.deepEqual(
          bare.map((issue) => [issue.rule, issue.path, issue.observed, issue.limit]),
          [["row-column-mismatch", "/data/rows/0", 1, 2]],
        );
      });

      test("a table carrying roles still cannot be proposed", () => {
        const proposal = table([{ role: "added", cells: ["REQ-1", "x"] }], { target: "requirements.md" });
        assert.equal(Check(schema, proposal), true, "the shape is fine; the semantics are not");
        assert.deepEqual(
          validateStructuredExchangeSemantics(proposal as never).map((issue) => issue.rule),
          ["kind-not-proposable"],
        );
      });
    });

    test("the data variants are mutually exclusive, so oneOf can tell them apart", () => {
      const table = {
        schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
        kind: "table",
        data: { columns: ["c"], rows: [["v"]] },
      };
      const sequence = {
        schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
        kind: "sequence",
        data: { participants: [{ id: "p", label: "P" }], messages: [] },
      };
      assert.equal(Check(schema, table), true);
      assert.equal(Check(schema, sequence), true);
      // Mixing two variants matches neither branch cleanly
      assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a", label: "A" }], edges: [], columns: ["c"] } })), false);
    });
  });
});

/**
 * The schema the agent reads, beside the schema the code validates against.
 *
 * The skill ships a copy so the agent can read the contract without leaving its
 * skill directory — `skillPaths` are read-only exceptions to the sandbox, so a
 * file there is reachable and one in the application's own tree is not. Two
 * copies means two things that can drift, which is what this refuses.
 */
describe("the skill's copy of the schema", () => {
  test("is identical to the one the runtime validates against", () => {
    const contract = readFileSync(SCHEMA_PATH, "utf8");
    const beside = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills/structured-exchange/structured-exchange-1.json"),
      "utf8",
    );

    assert.equal(beside, contract, "the skill's schema copy has drifted from the contract");
  });
});

/**
 * How a document gets from a producer into the reader's hands.
 *
 * The channel is `details` on a tool result. It matters that this is the only one:
 * `details` is filled by a tool's implementation and never by the model, so a
 * proposal shown as an approval gate was produced by code rather than written by the
 * thing whose work is being reviewed.
 *
 * This SDK has no MCP client at all — its README recommends writing an extension for
 * anyone who wants one — so an external producer reaches this the same way anything
 * else does: through a tool, in-process, putting the envelope in `details`. That is
 * the contract a bridge would have to meet, and it is exercised here as a bridge
 * would exercise it.
 */
describe("the channel a document arrives on", () => {
  const envelope = {
    schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
    kind: "graph",
    data: { nodes: [{ id: "a", label: "A", kind: "block" }], edges: [] },
  };

  test("carries a document a tool put in details", () => {
    const { structured } = structuredExchangeField(envelope);
    assert.equal(typeof structured, "string");
    assert.deepEqual(JSON.parse(structured!), envelope);
  });

  test("carries one an external producer handed to a bridging tool unchanged", () => {
    // What a bridge does: receives an envelope from elsewhere and returns it as its
    // own tool result's details, without reshaping it.
    const fromOutside = JSON.parse(JSON.stringify({ ...envelope, target: "artifact-1" }));
    const { structured } = structuredExchangeField(fromOutside);

    assert.deepEqual(JSON.parse(structured!), fromOutside, "a bridge must not be able to alter what it relays");
  });

  test("ignores details that are not a structured-exchange document", () => {
    // Every tool in the process fills details with something; this must claim only
    // what declares itself.
    for (const other of [undefined, null, "text", 42, {}, { schema: "urn:something-else:1" }, { schema: 7 }]) {
      assert.deepEqual(structuredExchangeField(other), {}, `should ignore ${JSON.stringify(other)}`);
    }
  });

  test("claims a future version of the contract too, rather than going silent on it", () => {
    // A version this build does not understand must still reach the reader as a
    // refusal with a reason, not vanish into the raw output.
    const { structured } = structuredExchangeField({ ...envelope, schema: "urn:structured-exchange:99" });
    assert.equal(typeof structured, "string");
  });
});

/**
 * The contract carries meaning and never appearance.
 *
 * A colour or a position means nothing to the authority that applies a proposal —
 * it has its own styling — and it would compete with the one signal the approval
 * rendering exists to carry. So a producer states what a thing *is*, with `kind`,
 * and the reader's rendering decides how that looks.
 */
describe("presentation is not part of the exchange", () => {
  const attempted = [
    { colour: "#ff0000" },
    { color: "#ff0000" },
    { fill: "red" },
    { style: { fill: "red" } },
    { x: 10, y: 20 },
    { position: { x: 10, y: 20 } },
    { width: 200 },
    { icon: "battery" },
  ];

  for (const appearance of attempted) {
    const named = Object.keys(appearance)[0];
    test(`refuses an element declaring "${named}"`, () => {
      assert.equal(
        Check(schema, graph({ data: { nodes: [{ id: "a", label: "A", ...appearance }], edges: [] } })),
        false,
        `"${named}" was accepted on an element`,
      );
    });

    test(`refuses a relationship declaring "${named}"`, () => {
      const nodes = [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ];
      assert.equal(
        Check(schema, graph({ data: { nodes, edges: [{ from: "a", to: "b", kind: "k", ...appearance }] } })),
        false,
        `"${named}" was accepted on a relationship`,
      );
    });
  }

  test("accepts the type in its place, which is what a consumer can map", () => {
    assert.equal(Check(schema, graph({ data: { nodes: [{ id: "a", label: "A", kind: "battery" }], edges: [] } })), true);
  });
});

/**
 * A removal a reader can actually check.
 *
 * `ref` names something the authority knows and this application does not — it holds
 * one document, not the model — so a bare reference asks a reader to approve deleting
 * something they cannot see. The other fields describe it, exactly as declared fields
 * describe elsewhere in the contract, and identify nothing.
 */
describe("removals describe what goes", () => {
  const removal = (over: Record<string, unknown>) =>
    graph({ target: "T", removals: [{ type: "relationship", ref: "REL-88", ...over }] });

  test("a reference and a type are still all that is required", () => {
    assert.equal(Check(schema, graph({ target: "T", removals: [{ type: "element", ref: "EL-1" }] })), true);
  });

  test("accepts a description of what is being removed", () => {
    assert.equal(Check(schema, removal({ label: "Billing calls Ledger", kind: "calls", from: "a", to: "b" })), true);
  });

  test("takes those fields from the same definitions the rest of the contract uses", () => {
    // Two definitions of one idea drift; a removal's label is a label.
    const properties = schema.$defs.removal.properties;
    assert.deepEqual(properties.label, { $ref: "#/$defs/label" });
    assert.deepEqual(properties.kind, { $ref: "#/$defs/kind" });
    assert.deepEqual(properties.from, { $ref: "#/$defs/localId" });
    assert.deepEqual(properties.to, { $ref: "#/$defs/localId" });
  });

  test("still refuses anything it did not declare", () => {
    assert.equal(Check(schema, removal({ colour: "#ff0000" })), false);
    assert.equal(Check(schema, removal({ set: { label: "x" } })), false, "a removal is not a patch");
  });
});

/**
 * How many types a reader can be shown apart.
 *
 * This ceiling is unlike the others: it bounds not what fits in memory but what a
 * rendering can distinguish. Types are told apart by a colour and a pattern — sixty
 * four combinations — and past that two of them are drawn alike. A document a reader
 * cannot check is not one to accept quietly, so the contract refuses it and says why.
 *
 * The two vocabularies are counted independently, because they are independent: a
 * document may use every type available to elements and every type available to
 * relationships at once.
 */
describe("distinct types per vocabulary", () => {
  const CEILING = STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary;

  const withKinds = (elementKinds: number, relationshipKinds: number) => {
    const nodes = Array.from({ length: Math.max(elementKinds, relationshipKinds + 1, 1) }, (_, index) => ({
      id: `n${index}`,
      label: `N${index}`,
      kind: `ek${index % Math.max(elementKinds, 1)}`,
    }));
    const edges = Array.from({ length: relationshipKinds }, (_, index) => ({
      from: `n${index}`,
      to: `n${index + 1}`,
      kind: `rk${index}`,
    }));
    return {
      schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
      kind: "graph" as const,
      data: { nodes, edges },
    } satisfies StructuredExchangeEnvelope;
  };

  const refusals = (document: ReturnType<typeof withKinds>) =>
    validateStructuredExchangeSemantics(document).filter((issue) => issue.rule === "too-many-kinds");

  test(`accepts ${CEILING} of each, which is the ceiling exactly`, () => {
    assert.deepEqual(refusals(withKinds(CEILING, CEILING)), []);
  });

  test(`refuses ${CEILING + 1} element types`, () => {
    const [issue] = refusals(withKinds(CEILING + 1, 1));
    assert.ok(issue, "one over the ceiling must be refused");
    assert.equal(issue.observed, CEILING + 1);
    assert.equal(issue.limit, CEILING);
    assert.match(issue.message, /told apart/);
  });

  test(`refuses ${CEILING + 1} relationship types`, () => {
    const [issue] = refusals(withKinds(1, CEILING + 1));
    assert.ok(issue, "the other vocabulary is bounded too");
    assert.equal(issue.observed, CEILING + 1);
  });

  test("counts the two vocabularies independently", () => {
    // Sixty-four of each is not one hundred and twenty-eight of anything.
    assert.deepEqual(refusals(withKinds(CEILING, CEILING)), []);
    // …and one vocabulary going over does not implicate the other
    const over = refusals(withKinds(CEILING + 1, 2));
    assert.equal(over.length, 1);
  });

  test("says which vocabulary, so a producer knows what to cut", () => {
    assert.match(refusals(withKinds(CEILING + 1, 1))[0].message, /element types/);
    assert.match(refusals(withKinds(1, CEILING + 1))[0].message, /relationship types/);
  });

  test("names a sequence's vocabularies by their own nouns", () => {
    const participants = Array.from({ length: CEILING + 1 }, (_, index) => ({
      id: `p${index}`,
      label: `P${index}`,
      kind: `k${index}`,
    }));
    const document = {
      schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
      kind: "sequence" as const,
      data: { participants, messages: [] },
    } satisfies StructuredExchangeEnvelope;
    const [issue] = validateStructuredExchangeSemantics(document).filter((i) => i.rule === "too-many-kinds");
    assert.match(issue.message, /participant types/);
  });

  test("is mirrored by what the renderer can actually distinguish", () => {
    // If these ever disagree, the contract is admitting documents the rendering
    // cannot show, which is the thing the ceiling exists to prevent.
    assert.equal(CEILING, 16 * 4, "sixteen colours by four patterns");
  });
});
