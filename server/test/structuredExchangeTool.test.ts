/**
 * The tool that makes the agent a producer.
 *
 * The interesting behaviour is not the happy path — it is what a *refused*
 * document does. A language model writes plausible-but-wrong JSON, so a contract
 * this strict is only usable if the refusal comes back as something the agent can
 * read and act on inside the same turn.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S, STRUCTURED_EXCHANGE_SCHEMA_V1 } from "@pi-outpost/shared/structured-exchange";
import { structuredExchangeField } from "../src/convert.ts";

const tool = createStructuredExchangeToolDefinition();

const call = (document: unknown, summary = "a summary") =>
  tool.execute("call-1", { document: typeof document === "string" ? document : JSON.stringify(document), summary }) as Promise<{
    content: { type: string; text: string }[];
    details?: unknown;
    isError?: boolean;
  }>;

const graph = (over: Record<string, unknown> = {}) => ({
  schema: S,
  kind: "graph",
  data: {
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    edges: [{ from: "a", to: "b", kind: "calls" }],
  },
  ...over,
});

describe("present_structure", () => {
  test("puts a validated document on the channel the interface reads", async () => {
    const result = await call(graph());

    assert.equal(result.isError, undefined);
    assert.equal((result.details as { schema: string }).schema, S);
    assert.equal((result.details as { kind: string }).kind, "graph");
  });

  test("carries the agent's summary in the text, because the document will not come back to it", async () => {
    const result = await call(graph(), "Billing calls Ledger.");

    const text = result.content[0].text;
    assert.match(text, /Billing calls Ledger\./);
    // Plus a factual digest, so the summary is never the only account of what was sent
    assert.match(text, /2 elements, 1 relationships/);
  });

  test("tallies what the reader will see, since the agent will not see it", async () => {
    const result = await call(
      graph({ target: "architecture-v4", removals: [{ type: "relationship", ref: "REL-9" }] }),
    );

    assert.match(result.content[0].text, /proposing changes to "architecture-v4"/);
    assert.match(result.content[0].text, /3 added, 0 changed/);
    assert.match(result.content[0].text, /1 removed/);
  });

  test("says so when a proposal turns out to change nothing", async () => {
    // The mistake this catches, seen for real in the running app: the agent wrote
    // the new name beside the reference instead of in `set`, which declares the
    // current value and applies nothing. Inert is right; silent is not.
    const result = await call(
      graph({
        target: "architecture-v4",
        data: { nodes: [{ id: "a", ref: "EL-7", label: "General Ledger" }], edges: [] },
      }),
    );

    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /0 changed/);
    assert.match(result.content[0].text, /changes nothing/);
    assert.match(result.content[0].text, /goes in "set"/);
  });

  describe("a refusal is something the agent can act on", () => {
    test("comes back as an error, not as an empty presentation", async () => {
      const result = await call(graph({ data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "zz", kind: "k" }] } }));

      assert.equal(result.isError, true);
      assert.equal(result.details, undefined);
    });

    test("names the rule and points at the offending value", async () => {
      const result = await call(graph({ data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "zz", kind: "k" }] } }));

      const text = result.content[0].text;
      assert.match(text, /unresolved-endpoint/);
      assert.match(text, /\/data\/edges\/0\/to/);
      assert.match(text, /call again/);
    });

    test("says that nothing is corrected for it", async () => {
      // Without this the agent may assume a near-miss was fixed silently.
      const result = await call(graph({ data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "aa", kind: "k" }] } }));

      assert.match(result.content[0].text, /not guessed at/);
    });

    test("reports every broken rule at once", async () => {
      const result = await call(
        graph({
          data: {
            nodes: [
              { id: "a", label: "A" },
              { id: "a", label: "again" },
            ],
            edges: [{ from: "a", to: "missing", kind: "k" }],
          },
        }),
      );

      const text = result.content[0].text;
      assert.match(text, /duplicate-identifier/);
      assert.match(text, /unresolved-endpoint/);
    });

    test("refuses a document that is not JSON at all", async () => {
      const result = await call("{ this is not json");

      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /not-json/);
    });

    test("refuses a table that tries to be a proposal", async () => {
      const result = await call({ schema: S, kind: "table", target: "T", data: { columns: ["c"], rows: [["v"]] } });

      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /kind-not-proposable/);
    });
  });

  test("a corrected document is accepted on the next call", async () => {
    // The loop the skill tells the agent to run, end to end.
    const refused = await call(graph({ data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "b", kind: "k" }] } }));
    assert.equal(refused.isError, true);

    const accepted = await call(graph());
    assert.equal(accepted.isError, undefined);
    assert.ok(accepted.details !== undefined);
  });
});

/**
 * The document, along the path it actually travels.
 *
 * Every other test here validates a string or inspects a rendered component. This
 * one goes tool → result → conversion, which is where the claim about preservation
 * has to hold, and where it was previously overstated: the tool keeps the parsed
 * envelope and the conversion serialises it again, so the producer's bytes do not
 * survive and never could. What must survive is every field, every order and every
 * value.
 */
describe("what survives from the tool to the interface", () => {

  /** Deliberately awkward: declaration order that a normalising step would tidy. */
  const document = JSON.stringify({
    schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
    kind: "graph",
    target: "artifact-1",
    removals: [
      { type: "relationship", ref: "REL-9", kind: "calls", from: "zeta", to: "alpha" },
      { type: "element", ref: "EL-9" },
    ],
    data: {
      nodes: [
        { id: "zeta", label: "Zeta", kind: "service" },
        { id: "alpha", ref: "EL-1", label: "Alpha", set: { label: "Alpha Prime", kind: "datastore" } },
        { id: "mid", label: "Mid" },
      ],
      edges: [
        { from: "zeta", to: "mid", kind: "writes" },
        { from: "zeta", to: "mid", kind: "reads", label: "second between the same pair" },
        { from: "mid", to: "mid", kind: "loops" },
      ],
    },
  });

  const recovered = async () => {
    const result = await tool.execute("call-1", { document, summary: "a summary" });
    const { structured } = structuredExchangeField((result as { details?: unknown }).details);
    assert.equal(typeof structured, "string", "the tool's document must reach the interface");
    return JSON.parse(structured!);
  };

  test("carries every field, every value and every order", async () => {
    assert.deepEqual(await recovered(), JSON.parse(document));
  });

  test("keeps declared order, which is the part a tidy-up would take", async () => {
    const back = await recovered();
    assert.deepEqual(back.data.nodes.map((n: { id: string }) => n.id), ["zeta", "alpha", "mid"]);
    assert.deepEqual(back.data.edges.map((e: { kind: string }) => e.kind), ["writes", "reads", "loops"]);
    assert.deepEqual(back.removals.map((r: { ref: string }) => r.ref), ["REL-9", "EL-9"]);
    // Key order too: a reader comparing two renderings should see the same shape
    assert.deepEqual(Object.keys(back), ["schema", "kind", "target", "removals", "data"]);
  });

  test("adds nothing that was not written", async () => {
    // A default filled in here is a value the producer never sent and the authority
    // would be asked to apply.
    const back = await recovered();
    assert.deepEqual(Object.keys(back.data.nodes[2]), ["id", "label"]);
    assert.deepEqual(Object.keys(back.removals[1]), ["type", "ref"]);
  });

  test("does not promise the producer's bytes, and says so where it counts", async () => {
    // The honest boundary: the document arrives parsed, so what comes back out is a
    // re-serialisation. It is the same document; it is not the same string, and no
    // test here should imply otherwise.
    const result = await tool.execute("call-1", { document, summary: "a summary" });
    const details = (result as { details?: unknown }).details;
    assert.equal(typeof details, "object", "the tool hands on a parsed value, not the text it was given");
    assert.deepEqual(details, JSON.parse(document));
  });

  test("names an enriched proposal's target and the revision it was prepared against", async () => {
    // Version 2's target is an object. Interpolated as-is it read `proposing
    // changes to "[object Object]"` — in the one account of the document the model
    // still has on a later turn, once the structured payload is gone.
    const result = await call({
      schema: "urn:structured-exchange:2",
      kind: "table",
      target: { ref: "reqs://module/42", revision: "baseline-7" },
      removals: [{ type: "row", ref: "REQ-9" }],
      data: {
        columns: ["id"],
        rows: [
          { heading: "1. Braking", depth: 1 },
          { cells: ["REQ-1"], ref: "REQ-1", set: { attributes: { status: "in review" } } },
          { cells: ["REQ-2"] },
          { cells: ["REQ-3"], ref: "REQ-3" },
        ],
      },
    });
    const text = result.content[0].text;
    assert.ok(!text.includes("[object Object]"), text);
    assert.match(text, /proposing changes to "reqs:\/\/module\/42"/);
    assert.match(text, /prepared against "baseline-7"/);
  });

  test("counts a table proposal's rows, which it used to call a proposal that changes nothing", async () => {
    // The tally read only graphs and sequences, so a real amendment came back
    // "0 changed … this proposal changes nothing" — a sentence written to correct
    // one specific mistake, aimed at a document that had not made it. A chapter is
    // not counted: it organises the rows around it.
    const result = await call({
      schema: "urn:structured-exchange:2",
      kind: "table",
      target: { ref: "reqs://module/42" },
      removals: [{ type: "row", ref: "REQ-9" }],
      data: {
        columns: ["id"],
        rows: [
          { heading: "1. Braking", depth: 1 },
          { cells: ["REQ-1"], ref: "REQ-1", set: { attributes: { status: "in review" } } },
          { cells: ["REQ-2"] },
          { cells: ["REQ-3"], ref: "REQ-3" },
        ],
      },
    });
    const text = result.content[0].text;
    assert.match(text, /1 added, 1 changed, 1 shown as unchanged context, 1 removed/);
    assert.ok(!text.includes("changes nothing"), text);
  });
});
