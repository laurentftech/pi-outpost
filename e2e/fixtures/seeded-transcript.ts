/**
 * A transcript with diagrams in it, served by the scripted RPC agent.
 *
 * The browser specs need a session that already contains what they are about —
 * a Mermaid fence and a structured exchange — and no model is going to produce
 * one on demand in an offline test run. `fake-pi-rpc.mjs` answers `get_messages`
 * from a file, so the transcript is written here and simply read back.
 *
 * Everything a widget shows for these lives behind that content: the enlarge
 * overlay, its portal, and the theme the diagrams are drawn in. Without a
 * transcript the suite could only ever assert the empty state, which is how an
 * overlay that lands unstyled and off-screen inside a Shadow DOM went unnoticed.
 */

/** Wide enough that the chat column has to scroll it — which is what enlarge is for. */
export const SEEDED_MERMAID = [
  "Here is how the pieces fit together.",
  "",
  "```mermaid",
  "graph LR",
  "  browser[Browser] --> widget[Embedded widget]",
  "  widget --> ws[WebSocket]",
  "  widget --> http[HTTP branding]",
  "  ws --> server[pi-outpost server]",
  "  http --> server",
  "  server --> agent[Agent runtime]",
  "  agent --> tools[Tools]",
  "  tools --> workspace[(Workspace)]",
  "  server --> sessions[(Sessions)]",
  "```",
].join("\n");

/** A graph envelope. Edges carry `kind`: the schema requires it of anything without a `ref`. */
const ENVELOPE = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: {
    nodes: [
      { id: "browser", label: "Browser" },
      { id: "widget", label: "Embedded widget" },
      { id: "ws", label: "WebSocket transport" },
      { id: "http", label: "HTTP branding request" },
      { id: "server", label: "pi-outpost server" },
      { id: "agent", label: "Agent runtime" },
      { id: "tools", label: "Tool surface" },
      { id: "workspace", label: "Workspace files" },
      { id: "sessions", label: "Session store" },
    ],
    edges: [
      { from: "browser", to: "widget", kind: "flow" },
      { from: "widget", to: "ws", kind: "flow" },
      { from: "widget", to: "http", kind: "flow" },
      { from: "ws", to: "server", kind: "flow" },
      { from: "http", to: "server", kind: "flow" },
      { from: "server", to: "agent", kind: "flow" },
      { from: "agent", to: "tools", kind: "flow" },
      { from: "tools", to: "workspace", kind: "flow" },
      { from: "server", to: "sessions", kind: "flow" },
    ],
  },
};

/**
 * The same system, grouped. Containers on a graph, and on a sequence whose
 * members are deliberately interleaved — declared battery(E), ecu(C),
 * alternator(E), dash(C) — so the browser can check that the view orders the
 * columns rather than splitting a container across two headers.
 */
const GRAPH_WITH_CONTAINERS = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: {
    containers: [
      { id: "electrical", label: "Electrical system" },
      { id: "control", label: "Control system" },
      { id: "hydraulic", label: "Hydraulic system" },
    ],
    nodes: [
      { id: "battery", label: "Battery", container: "electrical" },
      { id: "alternator", label: "Alternator", container: "electrical" },
      { id: "ecu", label: "Engine control unit", container: "control" },
      { id: "dash", label: "Dashboard", container: "control" },
      { id: "driver", label: "Driver" },
    ],
    edges: [
      { from: "driver", to: "ecu", kind: "operates" },
      { from: "ecu", to: "battery", kind: "reads" },
      { from: "alternator", to: "battery", kind: "charges" },
      { from: "ecu", to: "dash", kind: "signals" },
    ],
  },
};

const SEQUENCE_WITH_CONTAINERS = {
  schema: "urn:structured-exchange:1",
  kind: "sequence",
  data: {
    containers: [
      { id: "electrical", label: "Electrical system" },
      { id: "control", label: "Control system" },
    ],
    participants: [
      { id: "battery", label: "Battery", container: "electrical" },
      { id: "ecu", label: "Engine control unit", container: "control" },
      { id: "alternator", label: "Alternator", container: "electrical" },
      { id: "dash", label: "Dashboard", container: "control" },
    ],
    messages: [
      { from: "ecu", to: "battery", label: "read voltage" },
      { from: "ecu", to: "alternator", label: "excite" },
      { from: "alternator", to: "battery", label: "charge" },
      { from: "ecu", to: "dash", label: "warning light" },
    ],
  },
};

/**
 * An architecture whose elements declare what kind of thing they are.
 *
 * The other graphs here type their relationships and leave their elements bare,
 * so the elements' half of the key was always empty and the colour-by-type
 * vocabulary — the one thing that separates a domain from its neighbours in a
 * picture — never appeared in a running widget at all.
 *
 * Five element types and four relationship types, which is what makes the two
 * vocabularies visibly independent: `reads` is a relationship type and `store` an
 * element type, and a reader hiding one must not lose the other.
 */
const TYPED_GRAPH = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: {
    nodes: [
      { id: "portal", label: "Customer portal", kind: "ui" },
      { id: "orders", label: "Order service", kind: "service" },
      { id: "billing", label: "Billing service", kind: "service" },
      { id: "catalogue", label: "Catalogue service", kind: "service" },
      { id: "ledger", label: "Ledger", kind: "store" },
      { id: "orderdb", label: "Order store", kind: "store" },
      { id: "events", label: "Order events", kind: "queue" },
      { id: "psp", label: "Payment provider", kind: "external" },
      { id: "post", label: "Carrier API", kind: "external" },
    ],
    edges: [
      { from: "portal", to: "orders", kind: "calls" },
      { from: "portal", to: "catalogue", kind: "calls" },
      { from: "orders", to: "orderdb", kind: "writes" },
      { from: "orders", to: "events", kind: "publishes" },
      { from: "billing", to: "events", kind: "reads" },
      { from: "billing", to: "ledger", kind: "writes" },
      { from: "billing", to: "psp", kind: "calls" },
      { from: "orders", to: "post", kind: "calls" },
      { from: "catalogue", to: "orderdb", kind: "reads" },
    ],
  },
};

/**
 * A proposal over that architecture, with the types kept.
 *
 * Type and change travel on separate channels — colour for the type, emphasis for
 * the change — and the only way to see whether they compete is a document that
 * declares both: an added service of a type that is already present, a changed
 * store, a context element that changes nothing, and a removal.
 */
const TYPED_PROPOSAL = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  target: "architecture.md",
  removals: [{ type: "relationship", ref: "REL-catalogue-orderdb", label: "Catalogue reads the order store" }],
  data: {
    nodes: [
      { id: "search", label: "Search service", kind: "service" },
      { id: "catalogue", ref: "EL-catalogue", label: "Catalogue service", kind: "service" },
      { id: "orderdb", ref: "EL-orderdb", label: "Order store", kind: "store", set: { label: "Order store (sharded)" } },
      { id: "index", label: "Search index", kind: "store" },
    ],
    edges: [
      { from: "search", to: "index", kind: "writes" },
      { from: "catalogue", to: "search", kind: "calls" },
    ],
  },
};

/**
 * A table, and the one kind that is HTML text rather than a picture.
 *
 * SVG text carries an explicit `fill` and inherits nothing, so a diagram cannot
 * show what the overlay inherits from. A requirement in prose can, which is how
 * an overlay portalled past the app's own root — and inheriting the host page's
 * `* { color: red }` — stayed invisible until someone enlarged a table.
 */
const REQUIREMENTS_TABLE = {
  schema: "urn:structured-exchange:1",
  kind: "table",
  data: {
    columns: ["ID", "Requirement", "Status", "Safety"],
    rows: [
      ["REQ-001", "The braking system shall bring the vehicle to a full stop within 40 m on dry asphalt.", "approved", true],
      ["REQ-002", "The dashboard shall signal a fault within 200 ms of detection.", "in review", true],
      ["REQ-003", "The system shall log every actuation with a monotonic timestamp.", "approved", false],
      ["REQ-004", "The ECU shall read battery voltage at 10 Hz.", "draft", null],
    ],
  },
};

/**
 * The same table, reporting on a change rather than describing a state.
 *
 * A table cannot be proposed — it has no identity per row to patch against — but
 * it can say what a change did to the rows it projects, and that is the only
 * rendering in the application where a change role is drawn in HTML rather than
 * in SVG. Which makes it the one that a host page's stylesheet can reach.
 */
const REQUIREMENTS_CHANGE_TABLE = {
  schema: "urn:structured-exchange:1",
  kind: "table",
  data: {
    columns: ["ID", "Requirement", "Status"],
    rows: [
      // The comma is deliberate: prose is where a CSV export breaks, and this row
      // is the one the browser test parses back.
      { role: "added", cells: ["REQ-005", "The system shall log every actuation, with a monotonic timestamp.", "draft"] },
      { role: "changed", cells: ["REQ-002", "The dashboard shall signal a fault within 100 ms of detection.", "in review"] },
      { role: "removed", cells: ["REQ-003", "The ECU shall read battery voltage at 10 Hz.", "withdrawn"] },
      { cells: ["REQ-001", "The braking system shall bring the vehicle to a full stop within 40 m.", "approved"] },
    ],
  },
};


/**
 * The artifact the seeded proposal is bound to, written into the bench workspace
 * so a reader can actually open it — and so the mismatching case is a real refusal
 * rather than a missing file.
 */
export const VERIFICATION_REPORT = "Verification report for REQ-1\nBrake distance: 38.4 m over 12 runs.\nVerdict: pass\n";

/**
 * A specification extracted from an external requirements authority, of the shape
 * the enriched contract exists for: typed rows that *are* the requirements,
 * chapters that organise them, traceability that leaves the document, and a profile
 * this application has never heard of.
 *
 * Deliberately not minimal. The things that break in a browser and in no unit test
 * are the ones that need a real document under them: a detail panel inside a table
 * cell, a heading spanning columns whose widths the reader can drag, a relation
 * rendered on both of the rows it connects.
 */
const SPEC_EXTRACTION = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  data: {
    columns: ["id", "requirement", "verification"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      {
        id: "r1",
        ref: "REQ-1",
        kind: "requirement",
        cells: ["REQ-1", "The vehicle shall stop within 40 m from 100 km/h.", "test"],
        attributes: { status: "approved", safetyLevel: "ASIL-D", owner: { ref: "TEAM-BRAKES" } },
        locations: [{ uri: "workspace:notes/braking.md", range: { startLine: 0, endLine: 2 } }],
        artifacts: [
          // The digest of the file that is really there: opening this hands the
          // reader the bytes the approval is bound to.
          {
            rel: "verifiedBy",
            uri: "workspace:evidence/brake-distance.txt",
            sha256: "sha256:6d3ce5ed76cad820034d0747f1166f119d3b091786013ac116fdabbba79c5978",
            mediaType: "text/plain",
            label: "Bench run 412",
          },
          // The same file under a digest that is not its own — a link whose target
          // moved on since the extraction. Opening it must refuse rather than show
          // bytes nobody approved.
          {
            rel: "supersededReport",
            uri: "workspace:evidence/brake-distance.txt",
            sha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            mediaType: "text/plain",
            label: "Run 411 (stale)",
          },
        ],
      },
      { heading: "1.1 Sensing", depth: 2 },
      {
        id: "r2",
        ref: "REQ-2",
        kind: "requirement",
        cells: ["REQ-2", "Wheel speed shall be read at 100 Hz.", "analysis"],
        attributes: { status: "approved", safetyLevel: "ASIL-B" },
      },
      {
        id: "r3",
        ref: "REQ-3",
        kind: "requirement",
        cells: ["REQ-3", "A sensor fault shall be signalled within 200 ms.", "test"],
        attributes: { status: "in review", safetyLevel: "ASIL-D" },
      },
    ],
    relations: [
      { from: { id: "r2" }, to: { id: "r1" }, kind: "derives" },
      { from: { id: "r3" }, to: { id: "r1" }, kind: "derives" },
      { from: { id: "r1" }, to: { ref: "TEST-412" }, kind: "verifiedBy", label: "bench" },
    ],
  },
};

/**
 * The same specification, amended — what would be written back.
 *
 * It carries all four claims at once on one row, which is the case a reader must be
 * able to read at a glance and the one a merged rendering would ruin: what is true
 * now, what the producer expected to find, what it asks to set, what it asks to
 * unset. Plus a new requirement with no reference, and a withdrawal.
 */
const SPEC_PROPOSAL = {
  ...SPEC_EXTRACTION,
  target: { ref: "reqs://module/42", revision: "baseline-7" },
  removals: [
    { type: "row", ref: "REQ-9", label: "Battery voltage shall be read at 10 Hz.", kind: "requirement" },
  ],
  data: {
    ...SPEC_EXTRACTION.data,
    rows: [
      SPEC_EXTRACTION.data.rows[0],
      {
        ...SPEC_EXTRACTION.data.rows[1],
        expect: { attributes: { status: "approved" }, revision: "obj-rev-3" },
        set: { attributes: { status: "in review" }, removeAttributes: ["owner"] },
      },
      SPEC_EXTRACTION.data.rows[2],
      SPEC_EXTRACTION.data.rows[3],
      {
        id: "r4",
        kind: "requirement",
        cells: ["", "The driver shall be warned 20 m before the stopping point.", "test"],
      },
      SPEC_EXTRACTION.data.rows[4],
    ],
  },
};

/**
 * A power-train architecture that declares the readings it is made for.
 *
 * Seeded last so it moves no document the other specs find by position. Two viewpoints
 * over one graph, one retaining both vocabularies and one only elements, so a reader
 * can select each, adjust with the key, and return to the whole document.
 */
const VIEWPOINT_GRAPH = {
  schema: "urn:structured-exchange:2",
  kind: "graph",
  viewpoints: [
    {
      id: "power",
      label: "Power distribution",
      concern: "Where energy is stored, converted and consumed",
      elementKinds: ["source", "converter", "load"],
      relationshipKinds: ["power"],
    },
    {
      id: "control",
      label: "Control chain",
      concern: "Which computer commands which component",
      elementKinds: ["controller", "converter", "load"],
      relationshipKinds: ["signal"],
    },
  ],
  data: {
    nodes: [
      { id: "vp-battery", label: "Traction battery", kind: "source" },
      { id: "vp-inverter", label: "Inverter", kind: "converter" },
      { id: "vp-motor", label: "Drive motor", kind: "load" },
      { id: "vp-vcu", label: "Vehicle control unit", kind: "controller" },
      { id: "vp-bms", label: "Battery management", kind: "controller" },
    ],
    edges: [
      { from: "vp-battery", to: "vp-inverter", kind: "power" },
      { from: "vp-inverter", to: "vp-motor", kind: "power" },
      { from: "vp-vcu", to: "vp-inverter", kind: "signal" },
      { from: "vp-bms", to: "vp-battery", kind: "signal" },
      { from: "vp-vcu", to: "vp-motor", kind: "signal" },
    ],
  },
};

export const SEEDED_MESSAGES = [
  { role: "user", content: "Draw me the architecture." },
  { role: "assistant", content: [{ type: "text", text: SEEDED_MERMAID }] },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "structured_exchange", arguments: { kind: "graph" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "structured_exchange",
    content: "graph with 9 nodes",
    // The only channel the server forwards a structured exchange from.
    details: ENVELOPE,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-2", name: "structured_exchange", arguments: { kind: "graph" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-2",
    toolName: "structured_exchange",
    content: "graph with 5 elements in 3 containers",
    details: GRAPH_WITH_CONTAINERS,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-3", name: "structured_exchange", arguments: { kind: "sequence" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-3",
    toolName: "structured_exchange",
    content: "sequence whose containers interleave as declared",
    details: SEQUENCE_WITH_CONTAINERS,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-4", name: "structured_exchange", arguments: { kind: "table" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-4",
    toolName: "structured_exchange",
    content: "requirements table with 4 rows",
    details: REQUIREMENTS_TABLE,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-5", name: "structured_exchange", arguments: { kind: "table" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-5",
    toolName: "structured_exchange",
    content: "requirements table reporting one addition, one change and one removal",
    details: REQUIREMENTS_CHANGE_TABLE,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-6", name: "structured_exchange", arguments: { kind: "graph" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-6",
    toolName: "structured_exchange",
    content: "nine components across five domains: interface, services, stores, a queue and two externals",
    details: TYPED_GRAPH,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-7", name: "structured_exchange", arguments: { kind: "graph" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-7",
    toolName: "structured_exchange",
    content: "proposal: add a search service and its index, shard the order store, drop the catalogue's direct read",
    details: TYPED_PROPOSAL,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-8", name: "structured_exchange", arguments: { kind: "table" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-8",
    toolName: "structured_exchange",
    content: "extracted module 42: three requirements under two chapters, with traceability",
    details: SPEC_EXTRACTION,
  },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-9", name: "structured_exchange", arguments: { kind: "table" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-9",
    toolName: "structured_exchange",
    content: "proposal against baseline-7: amend REQ-2, add a warning requirement, withdraw REQ-9",
    details: SPEC_PROPOSAL,
  },
  { role: "user", content: "Show me the power train, with the readings it is made for." },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-viewpoints", name: "structured_exchange", arguments: { kind: "graph" } }],
  },
  {
    role: "toolResult",
    toolCallId: "call-viewpoints",
    toolName: "structured_exchange",
    content: "graph with 5 elements and 2 viewpoints",
    details: VIEWPOINT_GRAPH,
  },
];
