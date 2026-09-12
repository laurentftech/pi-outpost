import { describe, it, expect } from "vitest";
import {
  displayLabel,
  elementRole,
  fieldChanges,
  layoutGraph,
  readStructuredExchange,
  relationshipRole,
  toMermaid,
  validStructuredExchange,
} from "./structuredExchange";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";
import { STRUCTURED_EXCHANGE_BYTES_CEILING_ANY } from "@pi-outpost/shared/structured-exchange/bounds";

const graph = (over: Record<string, unknown> = {}) => ({
  schema: S,
  kind: "graph",
  data: { nodes: [{ id: "a", label: "A" }], edges: [] },
  ...over,
});
const serialize = (document: unknown) => JSON.stringify(document);

/**
 * Counting mermaid's relationship arrow, by substring rather than by pattern.
 *
 * Written as a regex this reads to a scanner — correctly — as an attempt to parse
 * HTML comments that misses `--!>`. Nothing here sanitises anything; these count what
 * the export declared, and a plain substring says that and nothing more.
 */
const ARROW = "--" + ">";
const hasArrow = (line: string) => line.includes(ARROW);
const countArrows = (text: string) => text.split(ARROW).length - 1;

describe("readStructuredExchange", () => {
  it("returns nothing when a result carries no structured payload", () => {
    expect(readStructuredExchange(undefined)).toBeUndefined();
    expect(readStructuredExchange("")).toBeUndefined();
  });

  it("reports why a payload that is not JSON was refused, rather than going quiet", () => {
    const verdict = readStructuredExchange("{not json");

    expect(verdict?.valid).toBe(false);
    expect(verdict?.valid === false && verdict.issues[0].rule).toBe("not-json");
    // What `match` consumes is still nothing at all, so no presentation is selected
    expect(validStructuredExchange("{not json")).toBeUndefined();
  });

  it("refuses an oversized payload before parsing it", () => {
    // The browser has to apply the byte bound too: routing straight to a parse
    // let an oversized result materialise, which is the one thing the bound exists
    // to prevent.
    //
    // Sized from the ceiling rather than a number written here: the gate before the
    // parse applies the widest any supported version allows, so a literal chosen
    // when there was one version silently stopped being oversized when there were
    // two, and this test went on passing for the wrong reason.
    const oversized = `{"schema":"${S}","junk":"${"x".repeat(STRUCTURED_EXCHANGE_BYTES_CEILING_ANY + 1)}`;

    const verdict = readStructuredExchange(oversized);

    expect(verdict?.valid).toBe(false);
    expect(verdict?.valid === false && verdict.issues[0].rule).toBe("document-too-large");
  });

  it("refuses rather than repairs a document with an unresolved endpoint", () => {
    const verdict = readStructuredExchange(
      serialize(graph({ data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "aa", kind: "k" }] } })),
    );

    expect(verdict?.valid).toBe(false);
    expect(validStructuredExchange(serialize(graph({ data: { nodes: [], edges: [] } })))).toBeUndefined();
  });

  it("accepts a conforming document", () => {
    expect(validStructuredExchange(serialize(graph()))?.kind).toBe("graph");
  });
});

describe("what each part of a proposal means", () => {
  it("treats an element with no reference as an addition", () => {
    expect(elementRole({ id: "a", label: "A" }, true)).toBe("added");
  });

  it("treats a reference with a declared change as a change", () => {
    expect(elementRole({ id: "a", ref: "R", set: { label: "renamed" } }, true)).toBe("changed");
  });

  it("treats a referenced element's own fields as description, not intent", () => {
    // The case the whole default turns on: an element included so the reader can
    // recognise it, carrying its current name, is not a rename.
    expect(elementRole({ id: "a", ref: "R", label: "Billing" }, true)).toBe("context");
    expect(elementRole({ id: "a", ref: "R" }, true)).toBe("context");
  });

  it("marks nothing when the envelope is a new artifact rather than a proposal", () => {
    expect(elementRole({ id: "a", label: "A" }, false)).toBe("unchanged");
    expect(elementRole({ id: "a", ref: "R", label: "A" }, false)).toBe("unchanged");
  });

  it("reads a relationship's declared fields as description too", () => {
    // Endpoints are identity and the rest describes; only `set` states intent.
    expect(relationshipRole({ from: "a", to: "b", ref: "R" }, true)).toBe("context");
    expect(relationshipRole({ from: "a", to: "b", ref: "R", kind: "calls" }, true)).toBe("context");
    expect(relationshipRole({ from: "a", to: "b", ref: "R", set: { kind: "invokes" } }, true)).toBe("changed");
    expect(relationshipRole({ from: "a", to: "b", kind: "composition" }, true)).toBe("added");
  });

  it("reports a change as a before and after when the current value was described", () => {
    expect(fieldChanges({ id: "a", ref: "R", label: "Ledger", set: { label: "General Ledger" } })).toEqual([
      { field: "label", from: "Ledger", to: "General Ledger" },
    ]);
  });

  it("reports a change without a before when no current value was described", () => {
    // The change still stands; it simply cannot be shown as a transition.
    expect(fieldChanges({ id: "a", ref: "R", set: { label: "General Ledger" } })).toEqual([
      { field: "label", to: "General Ledger" },
    ]);
  });

  it("reports nothing for something that declares no change", () => {
    expect(fieldChanges({ id: "a", ref: "R", label: "Ledger" })).toEqual([]);
  });
});

describe("layout", () => {
  /** A uniform size, so tests that care about placement are not about text metrics. */
  const uniform = () => ({ width: 100, height: 40 });

  const chain = {
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    edges: [
      { from: "a", to: "b", kind: "k" },
      { from: "b", to: "c", kind: "k" },
    ],
  };

  const xOf = (layout: ReturnType<typeof layoutGraph>, id: string) => layout.nodes.find((n) => n.id === id)!.x;

  it("places a chain in successive layers, left to right", () => {
    const layout = layoutGraph(chain, uniform);
    expect(xOf(layout, "a")).toBeLessThan(xOf(layout, "b"));
    expect(xOf(layout, "b")).toBeLessThan(xOf(layout, "c"));
  });

  it("is deterministic: the same document lays out the same way", () => {
    expect(layoutGraph(chain, uniform)).toEqual(layoutGraph(chain, uniform));
  });

  it("places the same chain in successive layers down the page when turned", () => {
    const yOf = (layout: ReturnType<typeof layoutGraph>, node: string) =>
      layout.nodes.find((n) => n.id === node)!.y;
    const turned = layoutGraph(chain, uniform, "portrait");
    expect(yOf(turned, "a")).toBeLessThan(yOf(turned, "b"));
    expect(yOf(turned, "b")).toBeLessThan(yOf(turned, "c"));
    // The ranks moved onto the other axis rather than merely being reordered: every
    // box of a chain shares a column, which is the whole point of turning it.
    expect(new Set(turned.nodes.map((n) => n.x)).size).toBe(1);
  });

  it("swaps which way the same chain is longer", () => {
    // What the reading column cares about: three boxes across overflow it, three
    // stacked do not.
    const flat = layoutGraph(chain, uniform);
    const tall = layoutGraph(chain, uniform, "portrait");
    expect(flat.width).toBeGreaterThan(flat.height);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(tall.width).toBeLessThan(flat.width);
  });

  it("sizes each box to its own contents rather than to the widest", () => {
    // One long label used to widen every box in the diagram, because the layout
    // took a single width for all of them.
    const sized = layoutGraph(chain, (node) => ({ width: node.id === "b" ? 300 : 100, height: 40 }));
    expect(sized.nodes.find((n) => n.id === "b")!.width).toBe(300);
    expect(sized.nodes.find((n) => n.id === "a")!.width).toBe(100);
  });

  const id = (n: string) => ({ id: n, label: n });
  const to = (from: string, target: string) => ({ from, to: target, kind: "k" });
  const cyclic = {
    nodes: ["batt", "bms", "ond", "mot", "dcdc", "vcu", "therm", "zcu", "hmi", "conn"].map(id),
    edges: [
      to("batt", "ond"),
      to("ond", "mot"),
      to("batt", "dcdc"),
      to("dcdc", "vcu"),
      to("vcu", "ond"),
      to("vcu", "bms"),
      to("bms", "batt"), // closes a loop
      to("bms", "vcu"), // and another
      to("vcu", "therm"),
      to("therm", "batt"), // and another
      to("vcu", "zcu"),
      to("zcu", "hmi"),
      to("hmi", "conn"),
      to("conn", "vcu"), // and another
    ],
  };

  it("keeps a cyclic architecture to a readable extent", () => {
    // The failure this exists for: a real seventeen-node architecture with feedback
    // loops — a battery manager sensing the battery it is controlled through — drew
    // twenty thousand pixels wide and one row tall, and arrived on screen as an
    // empty line. A cycle must not manufacture depth.
    const layout = layoutGraph(cyclic, uniform);

    expect(layout.width).toBeLessThan(cyclic.nodes.length * 100);
    // And it must have real height rather than collapsing to a single row
    expect(layout.height).toBeGreaterThan(40 * 2);
  });

  it("draws every element somewhere on the canvas", () => {
    const layout = layoutGraph(cyclic, uniform);

    expect(layout.nodes).toHaveLength(cyclic.nodes.length);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("never overlaps two boxes", () => {
    // The property that decides whether a diagram can be read at all, and the one
    // the hand-rolled layout could not promise.
    const layout = layoutGraph(cyclic, uniform);

    const overlaps = [];
    for (const a of layout.nodes) {
      for (const b of layout.nodes) {
        if (a.id >= b.id) continue;
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        if (!apart) overlaps.push(`${a.id}/${b.id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("terminates on a cycle instead of relaxing forever", () => {
    const cycle = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b", kind: "k" },
        { from: "b", to: "a", kind: "k" },
      ],
    };
    expect(() => layoutGraph(cycle, uniform)).not.toThrow();
    expect(layoutGraph(cycle, uniform).nodes).toHaveLength(2);
  });

  it("keeps two relationships between the same pair as two relationships", () => {
    // Collapsed into one edge, the second would stop influencing the layout.
    const parallel = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b", kind: "power" },
        { from: "a", to: "b", kind: "signal" },
      ],
    };
    expect(() => layoutGraph(parallel, uniform)).not.toThrow();
    expect(layoutGraph(parallel, uniform).nodes).toHaveLength(2);
  });

  it("falls back to a reference when an element declares no label", () => {
    expect(displayLabel({ id: "a", ref: "EL-1" })).toBe("EL-1");
    expect(displayLabel({ id: "a", ref: "EL-1", label: "Named" })).toBe("Named");
  });
});

describe("derived diagram export", () => {
  const envelope = validStructuredExchange(
    serialize({
      schema: S,
      kind: "graph",
      data: {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", kind: "composition" }],
      },
    }),
  )!;

  it("carries exactly the elements and relationships of the data it came from", () => {
    const mermaid = toMermaid(envelope)!;
    expect(mermaid).toContain("flowchart TD");
    expect(mermaid).toContain('"A"');
    expect(mermaid).toContain('"B"');
    expect(countArrows(mermaid)).toBe(1);
  });

  it("is deterministic", () => {
    expect(toMermaid(envelope)).toBe(toMermaid(envelope));
  });

  it("keeps producer text from becoming diagram syntax", () => {
    const hostile = validStructuredExchange(
      serialize({
        schema: S,
        kind: "graph",
        data: { nodes: [{ id: "a", label: 'A" --> evil["pwned' }], edges: [] },
      }),
    )!;

    const mermaid = toMermaid(hostile)!;
    // The label's own quotes are entity-escaped, so its text — arrows and all —
    // stays inside one node declaration. What matters is that no *structure*
    // appeared: still one node, still no relationship.
    const declarations = mermaid.split("\n").filter((line) => /^\s+n\w+\[/.test(line));
    const relationships = mermaid.split("\n").filter((line) => /^\s+n\w+ .*-->/.test(line));
    expect(declarations).toHaveLength(1);
    expect(relationships).toHaveLength(0);
    expect(mermaid).not.toContain('evil["pwned"]');
  });

  it("offers nothing for a table, rather than inventing a diagram for it", () => {
    const table = validStructuredExchange(serialize({ schema: S, kind: "table", data: { columns: ["c"], rows: [["v"]] } }))!;
    expect(toMermaid(table)).toBeUndefined();
  });
});

describe("producer text can never become diagram structure", () => {
  /**
   * The vectors, each of which is a plausible label and a piece of mermaid grammar.
   * `;` is the one that got through: it separates statements, so a participant name
   * carrying it declared a participant that was in no document.
   */
  const HOSTILE = [
    "A; participant injected as INJECTED",
    'A" --> evil["pwned',
    "A\nparticipant injected",
    "A #quot; injected",
    "A[injected]",
    "A-->B",
    "sequenceDiagram",
    "A;;;participant x",
    "A<script>alert(1)</script>",
    "A participant injected",
  ];

  const sequenceOf = (labels: string[]) =>
    validStructuredExchange(
      serialize({
        schema: S,
        kind: "sequence",
        data: {
          participants: labels.map((label, index) => ({ id: `p${index}`, label })),
          messages: labels.length > 1 ? [{ from: "p0", to: "p1", label: labels[0] }] : [],
        },
      }),
    )!;

  const graphOf = (labels: string[]) =>
    validStructuredExchange(
      serialize({
        schema: S,
        kind: "graph",
        data: {
          nodes: labels.map((label, index) => ({ id: `n${index}`, label })),
          edges: labels.length > 1 ? [{ from: "n0", to: "n1", kind: labels[0] }] : [],
        },
      }),
    )!;

  it("declares exactly as many sequence participants as the document has", () => {
    for (const hostile of HOSTILE) {
      const mermaid = toMermaid(sequenceOf([hostile, "Plain"]))!;
      const declarations = mermaid.split("\n").filter((line) => /^\s*participant\s/.test(line));
      expect(declarations, `for label ${JSON.stringify(hostile)}`).toHaveLength(2);
    }
  });

  it("declares exactly as many graph elements and relationships as the document has", () => {
    for (const hostile of HOSTILE) {
      const mermaid = toMermaid(graphOf([hostile, "Plain"]))!;
      const declarations = mermaid.split("\n").filter((line) => /^\s+n[0-9a-z]+\[/.test(line));
      const relationships = mermaid.split("\n").filter(hasArrow);
      expect(declarations, `for label ${JSON.stringify(hostile)}`).toHaveLength(2);
      expect(relationships, `for label ${JSON.stringify(hostile)}`).toHaveLength(1);
    }
  });

  it("emits no line the document did not call for", () => {
    for (const hostile of HOSTILE) {
      const lines = toMermaid(sequenceOf([hostile, "Plain"]))!.split("\n");
      // header + two participants + one message, and nothing else
      expect(lines, `for label ${JSON.stringify(hostile)}`).toHaveLength(4);
      expect(lines[0]).toBe("sequenceDiagram");
    }
  });

  it("lets no producer text spell an escape of its own", () => {
    // `#` opens mermaid's entity syntax and is what the escapes are written in.
    const mermaid = toMermaid(graphOf(["#quot; #59; #35;"]))!;
    expect(mermaid).toContain("#35;quot#59; #35;59#59; #35;35#59;");
    expect(mermaid).not.toMatch(/[^#]#quot;/);
  });

  it("names nodes only with identifiers it generated itself", () => {
    // Every id is derived from character codes, so no label can spell one.
    const mermaid = toMermaid(graphOf(["A; n0 --> n1", "Plain"]))!;
    for (const id of mermaid.match(/\bn[0-9a-z]+\b(?=[\s[])/g) ?? []) {
      expect(id).toMatch(/^n[0-9a-z]+$/);
    }
    expect(mermaid.split("\n").filter(hasArrow)).toHaveLength(1);
  });

  it("stays parseable by mermaid itself", async () => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });

    for (const hostile of HOSTILE) {
      await expect(
        mermaid.parse(toMermaid(sequenceOf([hostile, "Plain"]))!),
        `sequence for ${JSON.stringify(hostile)}`,
      ).resolves.toBeTruthy();
      await expect(
        mermaid.parse(toMermaid(graphOf([hostile, "Plain"]))!),
        `graph for ${JSON.stringify(hostile)}`,
      ).resolves.toBeTruthy();
    }
  });

  it("is still deterministic under hostile input", () => {
    const envelope = sequenceOf([HOSTILE[0], "Plain"]);
    expect(toMermaid(envelope)).toBe(toMermaid(envelope));
  });
});

describe("containers in the derived syntax", () => {
  const graph = {
    schema: "urn:structured-exchange:1" as const,
    kind: "graph" as const,
    data: {
      containers: [{ id: "electrical", label: "Electrical system" }],
      nodes: [
        { id: "battery", label: "Battery", container: "electrical" },
        { id: "ecu", label: "ECU" },
      ],
      edges: [{ from: "ecu", to: "battery", kind: "reads" }],
    },
  };

  it("nests a graph's members in a subgraph and leaves the rest outside it", () => {
    const mermaid = toMermaid(graph)!;

    expect(mermaid).toContain('subgraph');
    expect(mermaid).toContain('["Electrical system"]');
    // The grouped node inside the block, the ungrouped one after it
    const lines = mermaid.split("\n");
    const openAt = lines.findIndex((line) => line.includes("subgraph"));
    const endAt = lines.findIndex((line) => line.trim() === "end");
    const inside = lines.slice(openAt + 1, endAt).join("\n");
    expect(inside).toContain('"Battery"');
    expect(inside).not.toContain('"ECU"');
  });

  it("declares a crossing relationship outside every group", () => {
    // An edge belongs to no container, so nesting it in one would say otherwise.
    const lines = toMermaid(graph)!.split("\n");
    const endAt = lines.findIndex((line) => line.trim() === "end");
    const relationship = lines.findIndex((line) => line.includes("-->"));
    expect(relationship).toBeGreaterThan(endAt);
  });

  it("groups sequence participants with a box", () => {
    const mermaid = toMermaid({
      schema: "urn:structured-exchange:1" as const,
      kind: "sequence" as const,
      data: {
        containers: [{ id: "control", label: "Control system" }],
        participants: [
          { id: "ecu", label: "ECU", container: "control" },
          { id: "driver", label: "Driver" },
        ],
        messages: [{ from: "driver", to: "ecu", label: "contact" }],
      },
    })!;

    expect(mermaid).toContain("box Control system");
    expect(mermaid.split("\n").filter((line) => line.trim() === "end")).toHaveLength(1);
  });

  it("emits exactly what it did before when nothing is grouped", () => {
    const plain = {
      schema: "urn:structured-exchange:1" as const,
      kind: "graph" as const,
      data: { nodes: [{ id: "a", label: "A" }], edges: [] },
    };

    expect(toMermaid(plain)).not.toContain("subgraph");
  });
});
