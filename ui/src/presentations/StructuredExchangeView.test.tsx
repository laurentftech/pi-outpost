import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";
import { selectPresentation, PRESENTATIONS } from "./registry";
import { structuredExchangePresentation } from "./StructuredExchangeView";
import { ROLE_LABEL, TABLE_ROLE_LABEL, validStructuredExchange } from "./structuredExchange";
import { KIND_PRESENTATIONS } from "./StructuredExchangeView";
import { STRUCTURED_EXCHANGE_CEILINGS } from "@pi-outpost/shared/structured-exchange";
import * as structuredExchangeModule from "./structuredExchange";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const tool = (over: Partial<ToolItem> = {}): ToolItem => ({
  kind: "tool",
  toolCallId: "t1",
  toolName: "some_tool",
  args: {},
  output: "the original output",
  ...over,
});

const withStructured = (document: unknown, over: Partial<ToolItem> = {}) =>
  tool({ structured: JSON.stringify(document), ...over });

const proposal = {
  schema: S,
  kind: "graph",
  target: "artifact-1",
  removals: [{ type: "relationship", ref: "REL-9" }],
  data: {
    nodes: [
      { id: "keep", ref: "EL-1" },
      { id: "rename", ref: "EL-2", label: "Ledger", set: { label: "General Ledger" } },
      { id: "fresh", label: "Brand new" },
    ],
    edges: [{ from: "fresh", to: "keep", kind: "composition" }],
  },
};

const newArtifact = {
  schema: S,
  kind: "graph",
  data: { nodes: [{ id: "a", label: "A" }], edges: [] },
};


/**
 * Toggle a key entry the way a pointer does: press, release, then click.
 *
 * A synthetic `click` on its own is not how anyone reaches this control, and driving
 * it that way hid a real break for a whole session — the pan gesture on the canvas
 * called preventDefault on pointerdown, which suppresses the click that follows, so
 * the key was inert in the browser while every test went on passing.
 */
const toggleLegend = (key: string) => {
  const entry = document.querySelector(`[data-legend-entry="${key}"]`)!;
  const target = entry.querySelector("text") ?? entry;
  const at = { clientX: 5, clientY: 5, button: 0, bubbles: true, cancelable: true };
  target.dispatchEvent(Object.assign(new MouseEvent("pointerdown", at), { pointerId: 1 }));
  target.dispatchEvent(Object.assign(new MouseEvent("pointerup", at), { pointerId: 1 }));
  fireEvent.click(target);
};


/**
 * Drag a box, the way a pointer does and the way React can see.
 *
 * Raw `dispatchEvent` is not wrapped in `act`, so the state the drag sets never
 * flushed and the rendering never changed — a drag test written that way asserts
 * against the diagram as it was before the drag, and passes for the wrong reason.
 * Found by checking whether "reset layout" had appeared: it had not.
 */
const dragBox = (index: number, by: { x: number; y: number }) => {
  const node = [...document.querySelectorAll('[data-draggable="node"]')][index] as SVGGElement;
  (node as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (node as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
  fireEvent.pointerDown(node, { clientX: 100, clientY: 200, button: 0, pointerId: 1 });
  fireEvent.pointerMove(node, { clientX: 100 + by.x, clientY: 200 + by.y, button: 0, pointerId: 1 });
  fireEvent.pointerUp(node, { clientX: 100 + by.x, clientY: 200 + by.y, button: 0, pointerId: 1 });
  // The drag must have taken effect, or everything below is asserting the old picture
  expect(screen.queryByText("reset layout"), "the drag did not register").not.toBeNull();
};

const renderBody = (item: ToolItem) =>
  render(<structuredExchangePresentation.Expanded item={item} dispatch={vi.fn()} />);

describe("registry placement", () => {
  it("selects the structured presentation for a validated envelope", () => {
    expect(selectPresentation(withStructured(newArtifact)).id).toBe("structured-exchange");
  });

  it("ignores an envelope that does not validate, falling back as usual", () => {
    const broken = withStructured({ schema: S, kind: "graph", data: { nodes: [], edges: [] } });
    expect(selectPresentation(broken).id).not.toBe("structured-exchange");
  });

  it("outranks a presentation that infers its shape from output", () => {
    // A result that also looks like a hit list: declared data beats a guess.
    const both = withStructured(newArtifact, { output: "src/main.ts:12:const x = 1\nsrc/other.ts:3:hello" });
    expect(selectPresentation(both).id).toBe("structured-exchange");
  });

  it("does not outrank an extension's own rendering of its tool", () => {
    const extensionOwned = withStructured(newArtifact, { outputHtml: "<p>the extension's own view</p>" });
    const chosen = selectPresentation(extensionOwned);
    expect(chosen.extensionOwned).toBe(true);
    expect(chosen.id).not.toBe("structured-exchange");
  });

  it("sits below the extension entry and above every shape guess", () => {
    const ids = PRESENTATIONS.map((presentation) => presentation.id);
    for (const entry of PRESENTATIONS.filter((presentation) => presentation.extensionOwned)) {
      expect(ids.indexOf(entry.id)).toBeLessThan(ids.indexOf("structured-exchange"));
    }
    expect(ids.indexOf("structured-exchange")).toBeLessThan(ids.indexOf("code-search"));
    expect(ids.indexOf("structured-exchange")).toBeLessThan(ids.indexOf("pi-render"));
  });

  it("declines a result with no structured payload without throwing", () => {
    expect(() => structuredExchangePresentation.match(tool())).not.toThrow();
    expect(structuredExchangePresentation.match(tool())).toBe(false);
  });
});

describe("approval view", () => {
  it("says which artifact it proposes to change", () => {
    renderBody(withStructured(proposal));
    expect(screen.getByText(/artifact-1/)).toBeInTheDocument();
  });

  it("distinguishes additions, changes, context, and removals", () => {
    const { container } = renderBody(withStructured(proposal));

    expect(container.querySelector('[data-element-role="added"]')).toBeInTheDocument();
    expect(container.querySelector('[data-element-role="changed"]')).toBeInTheDocument();
    expect(container.querySelector('[data-element-role="context"]')).toBeInTheDocument();
    expect(within(screen.getByTestId("structured-removals")).getByText(/REL-9/)).toBeInTheDocument();
  });

  it("shows a change as a before and after, not merely as changed", () => {
    // An approval view that says "changed" without saying from what is asking the
    // reader to approve something they cannot see.
    renderBody(withStructured(proposal));

    const changes = screen.getAllByTestId("field-changes").map((node) => node.textContent ?? "");
    expect(changes).toContain("label: Ledger → General Ledger");
  });

  it("shows every element it carries, none summarised", () => {
    const { container } = renderBody(withStructured(proposal));
    const drawn = container.querySelectorAll("[data-element-role]");
    expect(drawn).toHaveLength(proposal.data.nodes.length);
  });

  it("presents a new artifact as itself rather than as a set of changes", () => {
    const { container } = renderBody(withStructured(newArtifact));

    expect(screen.queryByText(/Proposed changes/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-element-role="unchanged"]')).toBeInTheDocument();
    expect(container.querySelector('[data-element-role="added"]')).not.toBeInTheDocument();
  });
});

describe("what stays reachable", () => {
  it("keeps the original output available", () => {
    renderBody(withStructured(newArtifact));
    fireEvent.click(screen.getByText(/show original output/));
    expect(screen.getByTestId("structured-raw-output")).toHaveTextContent("the original output");
  });

  it("shows the envelope the view is drawn from, which the raw output is not", () => {
    // The card showed the rendering, the derived syntax, the text equivalent and
    // the tool's own output — everything except the document all of those come
    // from. Asked why a node reads as added rather than context, that is the one
    // artifact that answers, and it never reaches the model to be asked about.
    renderBody(withStructured(proposal));
    fireEvent.click(screen.getByText(/show envelope/));

    const shown = screen.getByTestId("structured-envelope").textContent ?? "";
    expect(JSON.parse(shown)).toEqual(proposal);
    // Indented rather than as it arrived on one line: this is for reading
    expect(shown).toContain("\n  ");
    expect(screen.queryByTestId("structured-raw-output")).not.toBeInTheDocument();
  });

  it("offers a textual equivalent of what the view displays", () => {
    renderBody(withStructured(proposal));
    fireEvent.click(screen.getByText(/show text equivalent/));

    const text = screen.getByTestId("structured-text-equivalent").textContent ?? "";
    expect(text).toContain("Brand new");
    expect(text).toContain("composition");
    expect(text).toContain("removed relationship: REL-9");
  });

  it("labels the diagram export as derived", () => {
    renderBody(withStructured(newArtifact));
    fireEvent.click(screen.getByText(/show derived diagram syntax/));
    expect(screen.getByText(/an export, not the source/)).toBeInTheDocument();
  });

  it("offers no diagram export for a table, rather than inventing one", () => {
    const table = { schema: S, kind: "table", data: { columns: ["c"], rows: [["v"]] } };
    renderBody(withStructured(table));
    expect(screen.queryByText(/derived diagram syntax/)).not.toBeInTheDocument();
  });
});

describe("declared order and declared kinds survive", () => {
  it("renders sequence messages in their declared order and direction", () => {
    const sequence = {
      schema: S,
      kind: "sequence",
      data: {
        participants: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
        messages: [
          { from: "a", to: "b", label: "first" },
          { from: "b", to: "a", label: "second" },
          { from: "a", to: "b", label: "third" },
        ],
      },
    };
    const { container } = renderBody(withStructured(sequence));

    const drawn = [...container.querySelectorAll("[data-message-index]")];
    expect(drawn).toHaveLength(3);
    // The hover text names the ends, not only what was said: on a lifeline diagram
    // the arrow gives the direction and nothing gives the who, once it has scrolled.
    expect(drawn.map((message) => message.querySelector("title")?.textContent)).toEqual([
      "1. Alpha → Beta: first",
      "2. Beta → Alpha: second",
      "3. Alpha → Beta: third",
    ]);

    // Direction, not just order: the second message runs back the other way, which
    // in a lifeline diagram means its arrow ends left of where it starts.
    expect(drawn.map((message) => [message.getAttribute("data-message-from"), message.getAttribute("data-message-to")])).toEqual([
      ["a", "b"],
      ["b", "a"],
      ["a", "b"],
    ]);
    const second = drawn[1].querySelector("line")!;
    expect(Number(second.getAttribute("x2"))).toBeLessThan(Number(second.getAttribute("x1")));
  });

  it("draws a lifeline per participant, so the shape reads as a sequence", () => {
    const sequence = {
      schema: S,
      kind: "sequence",
      data: {
        participants: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
        messages: [{ from: "a", to: "a", label: "self-call" }],
      },
    };
    const { container } = renderBody(withStructured(sequence));

    // One dashed lifeline per participant, and a self-message drawn as a loop
    // rather than as a zero-length arrow nobody can see.
    expect(container.querySelectorAll("line[stroke-dasharray]")).toHaveLength(2);
    expect(container.querySelector('[data-message-index="0"] path')).toBeInTheDocument();
    expect(container.querySelector('[data-message-index="0"] line')).toBeNull();
  });

  it("gives every column a divider the reader can take hold of", () => {
    const table = { schema: S, kind: "table", data: { columns: ["ID", "Requirement"], rows: [["REQ-1", "text"]] } };
    const { container } = renderBody(withStructured(table));

    // Named, so the divider is reachable without a mouse and says which column
    // it belongs to. A requirements table is where an unnamed handle is useless:
    // there are seven of them and they look alike.
    expect(screen.getByLabelText("Resize column ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Resize column Requirement")).toBeInTheDocument();

    // Untouched, the browser's own layout decides: no width is imposed
    const cols = [...container.querySelectorAll("col")];
    expect(cols).toHaveLength(2);
    expect(cols.every((col) => col.style.width === "")).toBe(true);
    expect(container.querySelector("table")!.style.tableLayout).toBe("");
  });

  it("widens and narrows a column from the keyboard, and stops at a column still being one", () => {
    const table = { schema: S, kind: "table", data: { columns: ["ID", "Requirement"], rows: [["REQ-1", "text"]] } };
    const { container } = renderBody(withStructured(table));
    const divider = screen.getByLabelText("Resize column ID");
    const widthOf = (index: number) => container.querySelectorAll("col")[index]!.style.width;

    fireEvent.keyDown(divider, { key: "ArrowRight" });
    const widened = parseFloat(widthOf(0));
    expect(widened).toBeGreaterThan(0);
    // Sizing the first column must not resize the second one out from under it
    const neighbour = widthOf(1);

    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(parseFloat(widthOf(0))).toBeGreaterThan(widened);
    expect(widthOf(1)).toBe(neighbour);

    // Down to the floor and no further: a column dragged to nothing cannot be
    // grabbed again, and the reader has no way back.
    for (let press = 0; press < 20; press += 1) fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(parseFloat(widthOf(0))).toBe(48);

    // Once sized, the widths are what lays the table out
    expect(container.querySelector("table")!.style.tableLayout).toBe("fixed");
  });

  it("keeps a reader's column sizing out of the document", () => {
    const table = { schema: S, kind: "table", data: { columns: ["ID"], rows: [["REQ-1"]] } };
    const item = withStructured(table);
    const before = item.structured;
    renderBody(item);

    fireEvent.keyDown(screen.getByLabelText("Resize column ID"), { key: "ArrowRight" });

    // Presentation only, per ReaderMayAdjustAndNarrowTheView
    expect(item.structured).toBe(before);
  });

  it("renders table columns and rows in their declared order", () => {
    const table = {
      schema: S,
      kind: "table",
      data: {
        columns: ["zebra", "alpha", "middle"],
        rows: [
          ["z1", "a1", "m1"],
          ["z2", "a2", "m2"],
        ],
      },
    };
    const { container } = renderBody(withStructured(table));

    expect([...container.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["zebra", "alpha", "middle"]);
    const firstRow = [...(container.querySelectorAll("tbody tr")[0]?.querySelectorAll("td") ?? [])];
    expect(firstRow.map((cell) => cell.textContent)).toEqual(["z1", "a1", "m1"]);
  });

  describe("a table's rows may report a change", () => {
    const roled = {
      schema: S,
      kind: "table",
      data: {
        columns: ["ID", "Requirement", "Status"],
        rows: [
          { role: "added", cells: ["REQ-5", "Log every actuation.", "draft"] },
          { role: "changed", cells: ["REQ-2", "Signal a fault within 200 ms.", "in review"] },
          { role: "removed", cells: ["REQ-3", "Read battery voltage at 10 Hz.", "withdrawn"] },
          { cells: ["REQ-1", "Stop within 40 m.", "approved"] },
        ],
      },
    };

    const rowsOf = (container: HTMLElement) => [...container.querySelectorAll("tbody tr")] as HTMLElement[];

    it("presents each declared role differently, and strikes a removed row through", () => {
      const { container } = renderBody(withStructured(roled));
      const rows = rowsOf(container);

      expect(rows.map((row) => row.dataset.rowRole)).toEqual(["added", "changed", "removed", "context"]);
      // Four rows, four distinct presentations: two roles that looked alike would
      // leave a reader unable to tell an addition from a deletion.
      expect(new Set(rows.map((row) => row.className)).size).toBe(4);
      // Colour is not the only channel for the one destructive role, and the strike
      // has to be on the cells: a decoration on the row never reaches them.
      expect(rows[2]!.querySelector("td")!.className).toContain("line-through");
    });

    it("marks an added row the way an added element is marked", () => {
      // One vocabulary across the kinds, in both channels a reader meets it in:
      // the word the key shows, and the colour family the ground comes from.
      expect(TABLE_ROLE_LABEL.added).toBe(ROLE_LABEL.added);
      expect(TABLE_ROLE_LABEL.changed).toBe(ROLE_LABEL.changed);
      expect(TABLE_ROLE_LABEL.context).toBe(ROLE_LABEL.context);

      const { container } = renderBody(withStructured(roled));
      const rows = rowsOf(container);
      // The diagram paints an addition emerald-50 (#ecfdf5) and a change amber-50
      // (#fffbeb); the table names the same two scales rather than picking its own.
      expect(rows[0]!.className).toContain("emerald");
      expect(rows[1]!.className).toContain("amber");
    });

    it("marks a row that declares nothing as context, among rows that declare something", () => {
      const { container } = renderBody(withStructured(roled));
      expect(rowsOf(container).at(-1)!.dataset.rowRole).toBe("context");
    });

    it("leaves a table that declares no role exactly as it was", () => {
      const plain = {
        schema: S,
        kind: "table",
        data: { columns: ["ID", "Status"], rows: [["REQ-1", "approved"], ["REQ-2", "draft"]] },
      };
      const { container, queryByTestId } = renderBody(withStructured(plain));

      expect(rowsOf(container).map((row) => row.dataset.rowRole)).toEqual([undefined, undefined]);
      expect(rowsOf(container).every((row) => row.className === "")).toBe(true);
      expect(queryByTestId("table-role-key")).toBeNull();
    });

    it("never reads a role out of the producer's own data", () => {
      // A "Status" column saying "added" is data. Colouring from it would leave a
      // producer unable to say "this row is unchanged and its status is added".
      const statuses = {
        schema: S,
        kind: "table",
        data: { columns: ["ID", "Status"], rows: [["REQ-1", "added"], ["REQ-2", "removed"]] },
      };
      const { container, queryByTestId } = renderBody(withStructured(statuses));

      expect(rowsOf(container).map((row) => row.dataset.rowRole)).toEqual([undefined, undefined]);
      expect(queryByTestId("table-role-key")).toBeNull();
    });

    it("names every role present in a key, and the same words in the text equivalent", () => {
      const { getByTestId, getByText } = renderBody(withStructured(roled));
      const key = getByTestId("table-role-key");

      expect([...key.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
        "added",
        "changed",
        "existing",
        "removed",
      ]);

      fireEvent.click(getByText("show text equivalent"));
      const text = getByTestId("structured-text-equivalent").textContent ?? "";
      expect(text).toContain("REQ-5 | Log every actuation. | draft  (added)");
      expect(text).toContain("REQ-1 | Stop within 40 m. | approved  (existing)");
      expect(text).toContain("(removed)");
    });

    it("hides the rows of a role the reader switches off, and says it is doing so", () => {
      const { container, getByTestId, getByText } = renderBody(withStructured(roled));

      fireEvent.click(within(getByTestId("table-role-key")).getByText("removed"));

      const rows = rowsOf(container);
      expect(rows.map((row) => row.dataset.rowRole)).toEqual(["added", "changed", "context"]);
      // Absent, not struck through: a hidden row must not read as a removed one
      expect(rows.some((row) => row.querySelector("td")!.className.includes("line-through"))).toBe(false);
      expect(getByTestId("structured-filtered").textContent).toContain("removed");
      expect(getByText("show everything")).toBeTruthy();
    });

    it("carries the narrowing into the text equivalent, which is how a table leaves here", () => {
      const { getByTestId, getByText } = renderBody(withStructured(roled));

      fireEvent.click(within(getByTestId("table-role-key")).getByText("removed"));
      fireEvent.click(getByText("show text equivalent"));

      const text = getByTestId("structured-text-equivalent").textContent ?? "";
      expect(text).toContain("Filtered view — 1 of 4 rows hidden (removed).");
      expect(text).not.toContain("Read battery voltage");
    });

    it("shows everything again when the reader asks", () => {
      const { container, getByTestId, getByText } = renderBody(withStructured(roled));

      fireEvent.click(within(getByTestId("table-role-key")).getByText("removed"));
      expect(rowsOf(container)).toHaveLength(3);
      fireEvent.click(getByText("show everything"));
      expect(rowsOf(container)).toHaveLength(4);
    });
  });

  it("keeps two relationships between the same pair distinct when their kinds differ", () => {
    const parallel = {
      schema: S,
      kind: "graph",
      data: {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [
          { from: "a", to: "b", kind: "composition" },
          { from: "a", to: "b", kind: "reference" },
        ],
      },
    };
    const { container } = renderBody(withStructured(parallel));

    // The kind reaches the reader through the hover whether or not the edge is
    // long enough to print it: a label that would overflow into the box it points
    // at is withheld rather than clipped.
    const summaries = [...container.querySelectorAll("g[data-relationship-role] title")].map((t) => t.textContent);
    expect(summaries.some((text) => text?.includes("composition"))).toBe(true);
    expect(summaries.some((text) => text?.includes("reference"))).toBe(true);
  });

  it("accepts a relationship kind it has never seen and does not interpret it", () => {
    const unfamiliar = {
      schema: S,
      kind: "graph",
      data: {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", kind: "zzz-entirely-made-up" }],
      },
    };
    expect(structuredExchangePresentation.match(withStructured(unfamiliar))).toBe(true);
    const { container } = renderBody(withStructured(unfamiliar));

    const summaries = [...container.querySelectorAll("g[data-relationship-role] title")].map((t) => t.textContent);
    expect(summaries.some((text) => text?.includes("zzz-entirely-made-up"))).toBe(true);
  });

  it("shows every element of a proposal at the contract's ceiling, none summarised", () => {
    // The scenario that constrains the view: an approval that samples is an
    // approval of something the reader did not see.
    const many = {
      schema: S,
      kind: "graph",
      target: "artifact-1",
      data: {
        nodes: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })),
        edges: [],
      },
    };
    const { container } = renderBody(withStructured(many));

    expect(container.querySelectorAll("[data-element-role]")).toHaveLength(500);
  });
});

describe("a diagram can leave the application", () => {
  const graph = {
    schema: S,
    kind: "graph",
    target: "arch v4",
    data: { nodes: [{ id: "a", label: "A" }], edges: [] },
  };

  it("offers a download, because a document wants a file", () => {
    // Word does not take an SVG pasted from the clipboard: it wants a file to
    // insert as a picture. Offering only "copy" would look like a feature and fail
    // at the one place it was for.
    renderBody(withStructured(graph));
    expect(screen.getByText(/download SVG/)).toBeInTheDocument();
    expect(screen.getByText(/copy markup/)).toBeInTheDocument();
  });

  it("names the file after what it holds, with nothing a filesystem would refuse", () => {
    const clicked: { download?: string; href?: string }[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === "a") {
        element.click = () => clicked.push({ download: element.getAttribute("download") ?? undefined });
      }
      return element;
    });
    // jsdom has no object URLs
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};

    renderBody(withStructured(graph));
    fireEvent.click(screen.getByText(/download SVG/));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("graph-arch-v4.svg");
    vi.restoreAllMocks();
  });

  it("hands over markup that stands on its own", () => {
    const { container } = renderBody(withStructured(graph));
    const markup = new XMLSerializer().serializeToString(container.querySelector("svg")!);

    // No stylesheet to leave behind, no foreign content to lose, and a ground of
    // its own so it does not arrive transparent.
    expect(markup).not.toContain("foreignObject");
    expect(markup).not.toContain('class="');
    expect(markup).toContain('fill="#ffffff"');
  });

  it("offers neither for a table, which is not a picture", () => {
    renderBody(withStructured({ schema: S, kind: "table", data: { columns: ["c"], rows: [["v"]] } }));
    expect(screen.queryByText(/download SVG/)).not.toBeInTheDocument();
  });
});

describe("a diagram can be seen at full size", () => {
  // A chat card is a narrow column. Shrinking a real diagram to fit it is how a
  // view becomes unreadable without anyone noticing.
  const graph = {
    schema: S,
    kind: "graph",
    data: { nodes: [{ id: "a", label: "A" }], edges: [] },
  };

  it("offers an enlarge control", () => {
    renderBody(withStructured(graph));
    expect(screen.getByLabelText(/full size/)).toBeInTheDocument();
    expect(screen.queryByTestId("structured-enlarged")).not.toBeInTheDocument();
  });

  it("opens and closes the enlarged view", () => {
    renderBody(withStructured(graph));

    fireEvent.click(screen.getByLabelText(/full size/));
    expect(screen.getByTestId("structured-enlarged")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("structured-enlarged")).not.toBeInTheDocument();
  });

  it("closes on Escape, so it is never a trap", () => {
    renderBody(withStructured(graph));
    fireEvent.click(screen.getByLabelText(/full size/));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("structured-enlarged")).not.toBeInTheDocument();
  });

  it("closes when the backdrop is clicked but not the diagram itself", () => {
    renderBody(withStructured(graph));
    fireEvent.click(screen.getByLabelText(/full size/));

    const overlay = screen.getByTestId("structured-enlarged");
    fireEvent.click(overlay.firstElementChild!);
    expect(screen.getByTestId("structured-enlarged")).toBeInTheDocument();

    fireEvent.click(overlay);
    expect(screen.queryByTestId("structured-enlarged")).not.toBeInTheDocument();
  });
});

describe("labels are not silently cut", () => {
  // On an approval view a truncated name is the worst kind of defect: the reader
  // cannot tell it from a short one, and two elements differing past the cut look
  // identical.
  const withLabels = (labels: string[]) => ({
    schema: S,
    kind: "graph",
    data: { nodes: labels.map((label, index) => ({ id: `n${index}`, label })), edges: [] },
  });

  it("widens the boxes to fit a long label", () => {
    const narrow = renderBody(withStructured(withLabels(["A", "B"])));
    const narrowWidth = Number(narrow.container.querySelector("[data-element-role] rect")?.getAttribute("width"));
    narrow.unmount();

    const wide = renderBody(withStructured(withLabels(["Payment Reconciliation Service", "B"])));
    const wideWidth = Number(wide.container.querySelector("[data-element-role] rect")?.getAttribute("width"));

    expect(wideWidth).toBeGreaterThan(narrowWidth);
  });

  it("stops widening past a bound, so one long name cannot stretch the diagram", () => {
    const { container } = renderBody(withStructured(withLabels(["x".repeat(400)])));
    expect(Number(container.querySelector("[data-element-role] rect")?.getAttribute("width"))).toBeLessThanOrEqual(260);
  });

  it("grows the boxes taller when they carry a change", () => {
    // The line that matters most on an approval view is the one saying what the
    // value is becoming; a fixed height cropped it.
    const plain = renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        target: "T",
        data: { nodes: [{ id: "a", ref: "R", label: "Ledger" }], edges: [] },
      }),
    );
    const plainHeight = Number(plain.container.querySelector("[data-element-role] rect")?.getAttribute("height"));
    plain.unmount();

    const changing = renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        target: "T",
        data: { nodes: [{ id: "a", ref: "R", label: "Ledger", set: { label: "General Ledger" } }], edges: [] },
      }),
    );
    expect(Number(changing.container.querySelector("[data-element-role] rect")?.getAttribute("height"))).toBeGreaterThan(plainHeight);
  });

  it("grows taller for a label that needs more than one line", () => {
    const oneLine = renderBody(withStructured(withLabels(["Short"])));
    const oneLineHeight = Number(oneLine.container.querySelector("[data-element-role] rect")?.getAttribute("height"));
    oneLine.unmount();

    const wrapped = renderBody(withStructured(withLabels(["x".repeat(200)])));
    expect(Number(wrapped.container.querySelector("[data-element-role] rect")?.getAttribute("height"))).toBeGreaterThan(oneLineHeight);
  });

  it("offers the full label on hover for whatever still overflows", () => {
    const label = "x".repeat(400);
    const { container } = renderBody(withStructured(withLabels([label])));

    expect(container.querySelector("[data-element-role] title")?.textContent).toContain(label.slice(0, 50));
  });

  it("widens a sequence's lifelines for long participant names", () => {
    const seq = (names: string[]) => ({
      schema: S,
      kind: "sequence",
      data: {
        participants: names.map((label, index) => ({ id: `p${index}`, label })),
        messages: [{ from: "p0", to: "p1", label: "go" }],
      },
    });
    const narrow = renderBody(withStructured(seq(["A", "B"])));
    const narrowWidth = Number(narrow.container.querySelector("[data-element-role] rect")?.getAttribute("width"));
    narrow.unmount();

    const wide = renderBody(withStructured(seq(["Order Management Frontend", "B"])));
    expect(Number(wide.container.querySelector("[data-element-role] rect")?.getAttribute("width"))).toBeGreaterThan(narrowWidth);
  });
});

describe("relationships in a proposal are legible too", () => {
  // The gap the element roles hid: on an architecture proposal, relationships are
  // most of what changes, and a drawn line has only its colour to say so with.
  const graphProposal = {
    schema: S,
    kind: "graph",
    target: "architecture-v4",
    data: {
      nodes: [
        { id: "billing", ref: "EL-12", label: "Billing" },
        { id: "ledger", ref: "EL-7", label: "Ledger" },
        { id: "audit", label: "Audit" },
      ],
      edges: [
        { from: "billing", to: "ledger", ref: "REL-1", kind: "calls" },
        { from: "billing", to: "ledger", ref: "REL-2", kind: "reads", set: { kind: "queries" } },
        { from: "audit", to: "billing", kind: "observes" },
      ],
    },
  };

  it("distinguishes an added, a changed, and a context relationship", () => {
    const { container } = renderBody(withStructured(graphProposal));

    const roles = [...container.querySelectorAll("g[data-relationship-role]")].map((g) =>
      g.getAttribute("data-relationship-role"),
    );
    expect(roles).toEqual(["context", "changed", "added"]);
  });

  it("shows what a changed relationship changes, as a before and after", () => {
    const { container } = renderBody(withStructured(graphProposal));

    // The edge here is short, so the change is withheld from the drawing rather
    // than printed under the box it points at — the hover is the channel that
    // never runs out of room, and it must carry it.
    const summaries = [...container.querySelectorAll("g[data-relationship-role] title")].map((t) => t.textContent);
    expect(summaries.some((text) => text?.includes("kind: reads → queries"))).toBe(true);
  });

  it("draws a context relationship differently from one that is being applied", () => {
    const { container } = renderBody(withStructured(graphProposal));

    const [context, changed] = [...container.querySelectorAll("g[data-relationship-role]")];

    // The dash now says what kind of relationship it is, so the role speaks through
    // channels of its own: a halo for anything being applied, and dimming for context.
    expect(changed.querySelector('path[data-edge="role"]')).not.toBeNull();
    expect(context.querySelector('path[data-edge="role"]')).toBeNull();
    expect(Number(context.querySelector('path[data-edge="line"]')!.getAttribute("opacity"))).toBeLessThan(1);
    expect(Number(changed.querySelector('path[data-edge="line"]')!.getAttribute("opacity"))).toBe(1);
  });

  it("keeps a relationship's own type visible while its role is marked", () => {
    /**
     * Role used to win the stroke outright, so every added relationship was drawn in
     * one green whatever it was — two relationships of different types, same role and
     * same label, were indistinguishable.
     */
    const twoAdded = {
      schema: S,
      kind: "graph",
      target: "artifact-1",
      data: {
        nodes: [
          { id: "a", ref: "EL-1", label: "A" },
          { id: "b", ref: "EL-2", label: "B" },
          { id: "c", ref: "EL-3", label: "C" },
        ],
        edges: [
          { from: "a", to: "b", kind: "power" },
          { from: "a", to: "c", kind: "signal" },
        ],
      },
    };
    const { container } = renderBody(withStructured(twoAdded));
    const lines = [...container.querySelectorAll('path[data-edge="line"]')];

    expect(lines).toHaveLength(2);
    // Both are additions…
    expect(container.querySelectorAll('path[data-edge="role"]')).toHaveLength(2);
    // …and they are still not the same relationship
    expect(lines[0].getAttribute("stroke")).not.toBe(lines[1].getAttribute("stroke"));
  });

  it("does the same for a sequence's messages", () => {
    const sequenceProposal = {
      schema: S,
      kind: "sequence",
      target: "protocol-v2",
      data: {
        participants: [
          { id: "client", ref: "P-1", label: "Client" },
          { id: "api", ref: "P-2", label: "API" },
        ],
        messages: [
          { from: "client", to: "api", ref: "M-1", label: "POST /orders" },
          { from: "api", to: "client", ref: "M-2", label: "200 OK", set: { label: "201 Created" } },
          { from: "client", to: "api", label: "DELETE /orders/1" },
        ],
      },
    };
    const { container } = renderBody(withStructured(sequenceProposal));

    expect([...container.querySelectorAll("g[data-relationship-role]")].map((g) => g.getAttribute("data-relationship-role"))).toEqual([
      "context",
      "changed",
      "added",
    ]);
    expect([...container.querySelectorAll('[data-testid="relationship-change"]')].map((n) => n.textContent)).toEqual([
      "label: 200 OK → 201 Created",
    ]);
  });

  it("marks nothing on a relationship when the envelope is not a proposal", () => {
    const newArtifactGraph = {
      schema: S,
      kind: "graph",
      data: {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", kind: "calls" }],
      },
    };
    const { container } = renderBody(withStructured(newArtifactGraph));

    expect([...container.querySelectorAll("g[data-relationship-role]")].map((g) => g.getAttribute("data-relationship-role"))).toEqual([
      "unchanged",
    ]);
  });
});

describe("an approved proposal survives unaltered", () => {
  it("keeps the document exactly as it was validated, not a re-serialisation of it", () => {
    // Indented as the producer wrote it: a parse-and-restringify would compact it,
    // so an implementation that rebuilt the document would fail the last assertion.
    const asSent = JSON.stringify(
      { kind: "graph", schema: S, data: { edges: [], nodes: [{ label: "A", id: "a" }] } },
      null,
      2,
    );
    const item = tool({ structured: asSent });

    // Validation reads the document; it never rewrites what is carried.
    expect(structuredExchangePresentation.match(item)).toBe(true);
    expect(item.structured).toBe(asSent);
    expect(item.structured).not.toBe(JSON.stringify(JSON.parse(asSent)));
  });
});

describe("producer text is data, not markup", () => {
  it("renders markup-like labels as text", () => {
    const hostile = {
      schema: S,
      kind: "graph",
      data: { nodes: [{ id: "a", label: "<img src=x onerror=alert(1)>" }], edges: [] },
    };
    const { container } = renderBody(withStructured(hostile));

    expect(container.querySelector("img")).toBeNull();
    // Once in the drawn label and once in the hover, both as text
    expect(screen.getAllByText("<img src=x onerror=alert(1)>").length).toBeGreaterThan(0);
  });
});

describe("labels the producer wrote on two lines", () => {
  // Real producers write a name and the thing that qualifies it — "Batterie HV"
  // over "400-800V". Splitting on all whitespace reflowed the two into one
  // paragraph and lost the distinction they meant.
  const twoLine = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "batt", label: "Batterie HV\n400-800V" },
        { id: "bms", label: "BMS\nGestion batterie" },
      ],
      edges: [{ from: "bms", to: "batt", kind: "sense" }],
    },
  };

  it("keeps the break the producer asked for", () => {
    const { container } = renderBody(withStructured(twoLine));

    const first = [...container.querySelectorAll("[data-element-role]")][0];
    // One `text` per line, each at its own baseline. It was one `text` of `tspan`s
    // until the figure became a list of shapes a serializer can also draw: a tspan
    // positioned by x and y renders identically to a text positioned the same way,
    // and a flat list is what both renderers can walk. The contract asserted here —
    // that a newline the producer wrote stays two lines — is unchanged.
    const lines = [...first.querySelectorAll("text")].map((line) => line.textContent);
    expect(lines).toEqual(["Batterie HV", "400-800V"]);
  });

  it("sizes the box to its longest line, not to the whole string", () => {
    const { container } = renderBody(withStructured(twoLine));
    const width = Number(container.querySelector("[data-element-role] rect")?.getAttribute("width"));

    // "Gestion batterie" is the longest line at 16 characters; the concatenation
    // would be 20 and would make every box needlessly wide.
    expect(width).toBeLessThan(20 * 6.6 + 22);
  });

  it("still draws at a readable height rather than collapsing to a line", () => {
    const { container } = renderBody(withStructured(twoLine));
    const svg = container.querySelector("svg")!;

    // The symptom that started this: a diagram scaled into the chat column until
    // it was a few pixels tall. It keeps its own size and scrolls instead.
    expect(Number(svg.getAttribute("height"))).toBeGreaterThan(40);
    // No max-width to scale it down; the container scrolls instead
    expect(svg.getAttribute("style") ?? "").not.toContain("max-width");
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });
});

describe("colour carries type, and the key travels with the picture", () => {
  const typed = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "batt", label: "Battery", kind: "storage" },
        { id: "inv", label: "Inverter", kind: "converter" },
        { id: "mot", label: "Motor", kind: "actuator" },
      ],
      edges: [
        { from: "batt", to: "inv", kind: "power" },
        { from: "inv", to: "mot", kind: "power" },
      ],
    },
  };

  it("gives the same type the same appearance, and different types different ones", () => {
    renderBody(withStructured(typed));
    const boxes = [...document.querySelectorAll("[data-element-role] rect")];
    const looks = boxes.map((box) => `${box.getAttribute("fill")}/${box.getAttribute("stroke-dasharray") ?? "solid"}`);

    expect(new Set(looks).size).toBe(3);
    expect(boxes.every((box) => (box.getAttribute("fill") ?? "") !== "")).toBe(true);
  });

  it("draws the same type the same colour across two renders of the same document", () => {
    const first = renderBody(withStructured(typed));
    const fillOf = () =>
      [...document.querySelectorAll("[data-element-role] rect")].map((box) => box.getAttribute("fill"));
    const before = fillOf();
    first.unmount();

    renderBody(withStructured(typed));
    expect(fillOf()).toEqual(before);
  });

  it("names every type present in a key inside the SVG, so an exported figure explains itself", () => {
    renderBody(withStructured(typed));
    const legend = screen.getByTestId("diagram-legend");

    // Inside the SVG, not beside it on the page
    expect(legend.closest("svg")).not.toBeNull();
    const named = [...legend.querySelectorAll("text")].map((text) => text.textContent);
    expect(named).toEqual(expect.arrayContaining(["storage", "converter", "actuator", "power"]));
  });

  it("offers no key when the document declares no types", () => {
    // A key listing nothing is noise, and it would take up room in the export.
    renderBody(withStructured(newArtifact));
    expect(screen.queryByTestId("diagram-legend")).toBeNull();
  });

  it("keeps the approval signal when a proposal is also typed", () => {
    // Type takes the fill; role must still own the outline, or an added element
    // becomes indistinguishable from an existing one of the same type.
    const typedProposal = {
      ...proposal,
      data: {
        nodes: [
          { id: "keep", ref: "EL-1", label: "Existing", kind: "service" },
          { id: "fresh", label: "Brand new", kind: "service" },
        ],
        edges: [],
      },
    };
    renderBody(withStructured(typedProposal));

    const added = document.querySelector('[data-element-role="added"] rect')!;
    const context = document.querySelector('[data-element-role="context"] rect')!;

    // Same type, so the same fill…
    expect(added.getAttribute("fill")).toBe(context.getAttribute("fill"));
    // …and the role still tells them apart, by outline and by weight
    expect(added.getAttribute("stroke")).not.toBe(context.getAttribute("stroke"));
    expect(Number(added.getAttribute("stroke-width"))).toBeGreaterThan(
      Number(context.getAttribute("stroke-width")),
    );
  });

  it("explains the roles in the key too, but only for a proposal", () => {
    renderBody(withStructured(proposal));
    const named = [...screen.getByTestId("diagram-legend").querySelectorAll("text")].map((t) => t.textContent);
    expect(named).toEqual(expect.arrayContaining(["added"]));
  });

  it("tips an arrow in the colour of the line it ends", () => {
    // Keyed by role, a type-coloured relationship got a grey arrowhead.
    renderBody(withStructured(typed));
    const line = document.querySelector('[data-relationship-role] path[data-edge="line"]')!;
    const stroke = line.getAttribute("stroke")!;
    const marker = line.getAttribute("marker-end")!.replace(/^url\(#|\)$/g, "");

    const tip = document.getElementById(marker)!.querySelector("path")!;
    expect(tip.getAttribute("fill")).toBe(stroke);
  });
});

describe("filtering, without weakening the approval gate", () => {
  const typed = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "batt", label: "Battery", kind: "storage" },
        { id: "inv", label: "Inverter", kind: "converter" },
        { id: "mot", label: "Motor", kind: "actuator" },
      ],
      edges: [
        { from: "batt", to: "inv", kind: "power" },
        { from: "inv", to: "mot", kind: "power" },
      ],
    },
  };
  const entry = (key: string) => document.querySelector(`[data-legend-entry="${key}"]`)!;

  it("shows everything until the reader hides something", () => {
    renderBody(withStructured(typed));
    expect(document.querySelectorAll("[data-element-role]").length).toBe(3);
    expect(screen.queryByTestId("structured-filtered")).toBeNull();
  });

  it("hides a type when its key entry is clicked, and brings it back on a second click", () => {
    renderBody(withStructured(typed));

    toggleLegend("element:converter");
    expect(document.querySelectorAll("[data-element-role]").length).toBe(2);

    toggleLegend("element:converter");
    expect(document.querySelectorAll("[data-element-role]").length).toBe(3);
  });

  it("drops a relationship whose end has gone, rather than drawing a line to nowhere", () => {
    renderBody(withStructured(typed));
    toggleLegend("element:converter");
    // Both relationships ended at the inverter
    expect(document.querySelectorAll("[data-relationship-role]").length).toBe(0);
  });

  it("hides a relationship type on its own without touching the elements", () => {
    renderBody(withStructured(typed));
    toggleLegend("relationship:power");

    expect(document.querySelectorAll("[data-relationship-role]").length).toBe(0);
    expect(document.querySelectorAll("[data-element-role]").length).toBe(3);
  });

  it("says on screen that the picture is no longer the whole document", () => {
    // The view is an approval gate. A reader approving a filtered picture has to
    // know they are doing it.
    renderBody(withStructured(typed));
    toggleLegend("element:converter");

    const banner = screen.getByTestId("structured-filtered");
    expect(banner.textContent).toContain("converter");
    expect(banner.textContent).toMatch(/filtered/i);
  });

  it("keeps a hidden type in the key, marked hidden, so an exported figure says what is missing", () => {
    // The banner is HTML and stays behind on export; the key is inside the SVG.
    renderBody(withStructured(typed));
    toggleLegend("element:converter");

    const stillListed = entry("element:converter");
    expect(stillListed.closest("svg")).not.toBeNull();
    expect(stillListed.getAttribute("data-hidden")).toBe("true");
    expect(stillListed.querySelector("text")!.textContent).toBe("converter (hidden)");
  });

  it("never marks a hidden type the way it marks a removed one", () => {
    // A removal is struck through a few pixels away in the same view. Reusing that
    // for "switched off" would read, on a proposal, as a type being taken out of it.
    renderBody(withStructured(typed));
    toggleLegend("element:converter");

    expect(entry("element:converter").querySelector("text")!.getAttribute("text-decoration")).toBeNull();
  });

  it("restores everything from the banner", () => {
    renderBody(withStructured(typed));
    toggleLegend("element:converter");
    fireEvent.click(screen.getByText("show everything"));

    expect(document.querySelectorAll("[data-element-role]").length).toBe(3);
    expect(screen.queryByTestId("structured-filtered")).toBeNull();
  });

  it("tells assistive technology that what it is describing is a subset", () => {
    renderBody(withStructured(typed));
    toggleLegend("element:converter");

    const svg = document.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute("aria-label")).toMatch(/filtered to 2 elements/);
  });

  it("keeps a type's colour when another type is hidden", () => {
    // Re-assigning colours over the visible subset would repaint the diagram every
    // time the reader toggled something, which is exactly when they are comparing.
    renderBody(withStructured(typed));
    const fillOf = (id: string) =>
      [...document.querySelectorAll("[data-element-role]")]
        .find((box) => box.querySelector("title")?.textContent?.includes(id))
        ?.querySelector("rect")
        ?.getAttribute("fill");

    const before = fillOf("Battery");
    toggleLegend("element:converter");
    expect(fillOf("Battery")).toBe(before);
  });
});

describe("moving around the diagram", () => {
  const typed = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "a", label: "A", kind: "block" },
        { id: "b", label: "B", kind: "block" },
      ],
      edges: [{ from: "a", to: "b", kind: "calls" }],
    },
  };

  /** jsdom reports no layout, so a scrollable ancestor has to be declared. */
  const scrollable = (element: HTMLElement, over: number) => {
    Object.defineProperty(element, "scrollWidth", { value: 1000, configurable: true });
    Object.defineProperty(element, "clientWidth", { value: 1000 - over, configurable: true });
    Object.defineProperty(element, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(element, "clientHeight", { value: 100, configurable: true });
    element.scrollLeft = 200;
    element.scrollTop = 0;
    return element;
  };

  const press = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), {
        pointerId: 1,
      }),
    );

  it("pans the view when the ground is dragged, without moving anything in the drawing", () => {
    renderBody(withStructured(typed));
    const svg = document.querySelector('svg[role="img"]')! as SVGSVGElement;
    const box = svg.querySelector('[data-element-role] rect')!;
    const before = box.getAttribute("x");
    const scroller = scrollable(svg.parentElement as HTMLElement, 400);

    press(svg, "pointerdown", 500, 50);
    press(svg, "pointermove", 440, 50);
    press(svg, "pointerup", 440, 50);

    // The box scrolled into view; it did not move on the canvas, so the export is
    // exactly what it was.
    expect(scroller.scrollLeft).toBe(260);
    expect(box.getAttribute("x")).toBe(before);
  });

  it("leaves a press that landed on a box to that box, so panning cannot fight dragging", () => {
    renderBody(withStructured(typed));
    const svg = document.querySelector('svg[role="img"]')! as SVGSVGElement;
    const scroller = scrollable(svg.parentElement as HTMLElement, 400);
    const node = svg.querySelector('[data-draggable="node"]')!;

    press(node, "pointerdown", 500, 50);
    press(svg, "pointermove", 440, 50);

    expect(scroller.scrollLeft).toBe(200);
  });
});

describe("the two type vocabularies are independent", () => {
  // "power" is a plausible kind of block and a plausible kind of connection. Held in
  // one namespace, hiding either hid both.
  const shared = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "a", label: "Pack", kind: "power" },
        { id: "b", label: "Motor", kind: "drive" },
      ],
      edges: [{ from: "a", to: "b", kind: "power" }],
    },
  };
  const entry = (key: string) => document.querySelector(`[data-legend-entry="${key}"]`)!;

  it("hides a relationship type without hiding an element type of the same name", () => {
    renderBody(withStructured(shared));
    toggleLegend("relationship:power");

    expect(document.querySelectorAll("[data-relationship-role]").length).toBe(0);
    expect(document.querySelectorAll("[data-element-role]").length).toBe(2);
  });

  it("hides an element type without hiding a relationship type of the same name", () => {
    renderBody(withStructured(shared));
    toggleLegend("element:power");

    // The element goes, and the relationship goes with it only because it lost an end
    expect(document.querySelectorAll("[data-element-role]").length).toBe(1);
    // …and the relationship's own type is still switched on
    expect(entry("relationship:power").getAttribute("data-hidden")).toBeNull();
  });

  it("lists the shared name once per vocabulary", () => {
    renderBody(withStructured(shared));
    expect(entry("element:power")).not.toBeNull();
    expect(entry("relationship:power")).not.toBeNull();
  });

  it("names the type plainly in the banner, not by its internal key", () => {
    renderBody(withStructured(shared));
    toggleLegend("relationship:power");
    expect(screen.getByTestId("structured-filtered").textContent).toContain("power");
    expect(screen.getByTestId("structured-filtered").textContent).not.toContain("relationship:power");
  });
});

describe("a gesture never outlives what it was made on", () => {
  const typed = {
    schema: S,
    kind: "graph",
    data: { nodes: [{ id: "a", label: "A", kind: "block" }], edges: [] },
  };

  it("starts a drag where the pointer-capture API is missing entirely", () => {
    // jsdom has no pointer capture. Calling it unguarded threw inside a handler,
    // which surfaced as an unhandled rejection: every assertion passed and the suite
    // still exited non-zero.
    const view = renderBody(withStructured(typed));
    const node = document.querySelector('[data-draggable="node"]')!;

    expect(() =>
      node.dispatchEvent(
        Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5, button: 0 }), {
          pointerId: 1,
        }),
      ),
    ).not.toThrow();
    view.unmount();
  });

  it("drops its listeners when the component goes away mid-drag", () => {
    const view = renderBody(withStructured(typed));
    const node = document.querySelector('[data-draggable="node"]')! as HTMLElement;
    const removals: string[] = [];
    const realRemove = node.removeEventListener.bind(node);
    node.removeEventListener = (type: string, ...rest: unknown[]) => {
      removals.push(type);
      return realRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
    };

    node.dispatchEvent(
      Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5, button: 0 }), {
        pointerId: 1,
      }),
    );
    view.unmount();

    expect(removals).toEqual(expect.arrayContaining(["pointermove", "pointerup", "pointercancel"]));
  });
});

describe("every declared relationship is a relationship you can see", () => {
  const graphOf = (edges: unknown[]) => ({
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges,
    },
  });
  const paths = () =>
    [...document.querySelectorAll('[data-relationship-role] path[data-edge="line"]')].map((p) => p.getAttribute("d")!);

  /** Sample a path so two shapes can be compared as geometry rather than as strings. */
  const pointsOf = (d: string) =>
    (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).reduce<{ x: number; y: number }[]>((acc, n, i, all) => {
      if (i % 2 === 0 && i + 1 < all.length) acc.push({ x: n, y: all[i + 1] });
      return acc;
    }, []);

  it("draws a relationship from something to itself as a shape with real extent", () => {
    // A straight line between one box's centre and itself has zero length: the
    // document declared a relationship and the picture showed nothing at all.
    renderBody(withStructured(graphOf([{ from: "a", to: "a", kind: "feeds" }])));
    const [d] = paths();

    expect(d).toBeDefined();
    const points = pointsOf(d);
    const spanX = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const spanY = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    expect(spanX).toBeGreaterThan(10);
    expect(spanY).toBeGreaterThan(10);
    expect(document.querySelector('[data-relationship-shape="loop"]')).not.toBeNull();
  });

  it("keeps several loops on one element apart from each other", () => {
    renderBody(
      withStructured(
        graphOf([
          { from: "a", to: "a", kind: "feeds" },
          { from: "a", to: "a", kind: "senses" },
        ]),
      ),
    );
    const drawn = paths();
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).not.toBe(drawn[1]);
  });

  it("draws two relationships between the same pair as two distinct shapes", () => {
    // Straight lines between centres put these on exactly the same pixels, so a
    // reader counting connections counted one where the document had two.
    renderBody(
      withStructured(
        graphOf([
          { from: "a", to: "b", kind: "power" },
          { from: "a", to: "b", kind: "signal" },
        ]),
      ),
    );
    const drawn = paths();

    expect(drawn).toHaveLength(2);
    expect(drawn[0]).not.toBe(drawn[1]);
    // …and genuinely apart, not merely different strings
    const [first, second] = drawn.map(pointsOf);
    const apart = Math.max(...second.map((p, i) => Math.hypot(p.x - (first[i]?.x ?? p.x), p.y - (first[i]?.y ?? p.y))));
    expect(apart).toBeGreaterThan(8);
  });

  it("fans three relationships between one pair to either side of the straight run", () => {
    renderBody(
      withStructured(
        graphOf([
          { from: "a", to: "b", kind: "one" },
          { from: "a", to: "b", kind: "two" },
          { from: "a", to: "b", kind: "three" },
        ]),
      ),
    );
    const drawn = paths();
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn).size).toBe(3);
    // The first is the straight run; the other two curve, one each way
    expect(drawn[0]).toMatch(/^M [\d.-]+ [\d.-]+ L/);
    expect(drawn[1]).toContain("Q");
    expect(drawn[2]).toContain("Q");
  });

  it("gives opposite directions between the same pair their own straight run each", () => {
    // A→B and B→A are not the same pair, and neither should be pushed off the
    // straight line to make room for the other.
    renderBody(
      withStructured(
        graphOf([
          { from: "a", to: "b", kind: "requests" },
          { from: "b", to: "a", kind: "replies" },
        ]),
      ),
    );
    const drawn = paths();
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).not.toBe(drawn[1]);
    // Neither is a rank bow — a single quadratic from end to end with nothing in
    // between, which is what a relationship pushed aside to make room looks like.
    // Either may still curve, because the layout engine routes a back edge around
    // what it passes and that is the route being followed.
    for (const d of drawn) expect(d, `${d} should not be a rank bow`).not.toMatch(/^M [\d.-]+ [\d.-]+ Q [^LQ]+$/);
  });

  it("keeps direction, arrow, type and hover on every shape it draws", () => {
    renderBody(
      withStructured(
        graphOf([
          { from: "a", to: "b", kind: "power" },
          { from: "a", to: "b", kind: "signal" },
          { from: "a", to: "a", kind: "feeds" },
        ]),
      ),
    );
    const groups = [...document.querySelectorAll("[data-relationship-role]")];
    expect(groups).toHaveLength(3);

    for (const group of groups) {
      const path = group.querySelector('path[data-edge="line"]')!;
      expect(path.getAttribute("marker-end")).toMatch(/^url\(#se-arrow-/);
      expect(path.getAttribute("fill")).toBe("none");
      expect(group.querySelector("title")!.textContent).toBeTruthy();
    }
    // The types are all shown, so two parallel relationships stay tellable apart
    expect(document.querySelector("svg")!.textContent).toContain("power");
    expect(document.querySelector("svg")!.textContent).toContain("signal");
  });

  it("follows the layout engine's route rather than cutting across the boxes between", () => {
    // A long relationship in a layered graph is routed around whatever sits in the
    // ranks it spans; a straight line between centres draws over them.
    renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        data: {
          nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
          edges: [
            { from: "a", to: "b", kind: "k" },
            { from: "b", to: "c", kind: "k" },
            { from: "c", to: "d", kind: "k" },
            { from: "a", to: "d", kind: "k" },
          ],
        },
      }),
    );
    const spanning = paths().find((d) => (d.match(/L/g) ?? []).length > 1);
    expect(spanning, "the relationship spanning three ranks should be a routed polyline").toBeDefined();
  });

  it("turns its corners as curves rather than as kinks", () => {
    // A route drawn as bare segments turns through hard angles, which read as a
    // broken line rather than as a path going somewhere.
    renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        data: {
          nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
          edges: [
            { from: "a", to: "b", kind: "k" },
            { from: "b", to: "c", kind: "k" },
            { from: "c", to: "d", kind: "k" },
            { from: "a", to: "d", kind: "k" },
          ],
        },
      }),
    );

    const routed = paths().find((d) => (d.match(/L/g) ?? []).length > 1)!;
    expect(routed).toContain("Q");
    // Every corner rounded, so none is left as a bare angle
    expect((routed.match(/Q/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("leaves a two-point route alone rather than inventing a curve in it", () => {
    renderBody(
      withStructured(graphOf([{ from: "a", to: "b", kind: "k" }])),
    );
    expect(paths()[0]).not.toContain("Q");
  });
});

describe("what an export of a filtered view claims", () => {
  const typedProposal = {
    schema: S,
    kind: "graph",
    target: "artifact-1",
    data: {
      nodes: [
        { id: "keep", ref: "EL-1", label: "Existing", kind: "service" },
        { id: "store", ref: "EL-2", label: "Ledger", kind: "datastore" },
        { id: "fresh", label: "Brand new", kind: "service" },
      ],
      edges: [{ from: "fresh", to: "store", kind: "writes" }],
    },
  };
  const entry = (key: string) => document.querySelector(`[data-legend-entry="${key}"]`)!;

  /**
   * The decision, stated once: an export carries the view the reader is looking at,
   * and the figure says so on its face. Exporting the whole document instead would
   * hand back something the reader never saw, which is the worse failure for an
   * approval gate — but a filtered figure must never read as a smaller proposal.
   */
  it("draws only what is shown, and says so inside the figure", () => {
    renderBody(withStructured(typedProposal));
    toggleLegend("element:datastore");

    const svg = document.querySelector('svg[role="img"]')!;
    expect(svg.querySelectorAll("[data-element-role]").length).toBe(2);

    const note = screen.getByTestId("diagram-filter-note");
    expect(note.closest("svg")).not.toBeNull();
    expect(note.textContent).toContain("2 of 3 elements");
  });

  it("says on a proposal that a hidden type is still part of it", () => {
    renderBody(withStructured(typedProposal));
    toggleLegend("element:datastore");

    expect(screen.getByTestId("diagram-filter-note").textContent).toContain(
      "Hidden types are still part of the proposal",
    );
  });

  it("carries that note into the serialized markup, not only onto the screen", () => {
    renderBody(withStructured(typedProposal));
    toggleLegend("element:datastore");

    const markup = new XMLSerializer().serializeToString(document.querySelector('svg[role="img"]')!);
    expect(markup).toContain("2 of 3 elements");
    expect(markup).toContain("datastore (hidden)");
  });

  it("makes no such claim when nothing is filtered", () => {
    renderBody(withStructured(typedProposal));
    expect(screen.queryByTestId("diagram-filter-note")).toBeNull();
  });
});

describe("a long type name is not quietly cut off", () => {
  it("widens a narrow diagram to fit the key that explains it", () => {
    // The schema allows a hundred-character type name and the canvas width came from
    // the graph alone, so a two-node diagram drew a key that ran off the viewBox.
    const long = "a-very-long-domain-specific-stereotype-name-that-keeps-going";
    renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        data: { nodes: [{ id: "a", label: "A", kind: long }], edges: [] },
      }),
    );

    const svg = document.querySelector('svg[role="img"]')!;
    const [, , width] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const label = [...svg.querySelectorAll("[data-legend-entry] text")].find((t) =>
      t.textContent!.includes(long),
    )!;

    expect(Number(label.getAttribute("x")) + long.length * 5.6).toBeLessThanOrEqual(width);
  });
});

describe("the text equivalent says everything the picture says", () => {
  /**
   * A reader is on the text equivalent because they cannot see the diagram. Anything
   * only the diagram says is, for them, not said at all — so this checks the words
   * against the document, not against the SVG.
   */
  const textOf = (document_: unknown) => {
    renderBody(withStructured(document_));
    fireEvent.click(screen.getByText("show text equivalent"));
    return screen.getByTestId("structured-text-equivalent").textContent!;
  };

  const graph = {
    schema: S,
    kind: "graph",
    target: "artifact-1",
    removals: [{ type: "relationship", ref: "REL-9" }],
    data: {
      nodes: [
        { id: "batt", ref: "EL-1", label: "Battery", kind: "storage" },
        { id: "bms", ref: "EL-2", label: "BMS", kind: "controller", set: { label: "Battery manager" } },
        { id: "orphan", label: "Spare", kind: "storage" },
        { id: "mot", label: "Motor", kind: "actuator" },
      ],
      edges: [
        { from: "batt", to: "mot", kind: "power", label: "traction bus" },
        { from: "bms", to: "batt", kind: "control" },
        { from: "bms", to: "bms", kind: "diagnostic" },
      ],
    },
  };

  it("names every element, including one nothing connects to", () => {
    const text = textOf(graph);
    for (const name of ["Battery", "BMS", "Spare", "Motor"]) expect(text).toContain(name);
  });

  it("states each element's type, which the diagram carries only as a colour", () => {
    const text = textOf(graph);
    for (const kind of ["storage", "controller", "actuator"]) expect(text).toContain(`[${kind}]`);
  });

  it("keeps both a relationship's type and its label when it declares both", () => {
    // One standing in for the other lost whichever the traversal did not prefer.
    const text = textOf(graph);
    expect(text).toContain("power");
    expect(text).toContain("traction bus");
  });

  it("prefers the same name the diagram draws", () => {
    // The diagram draws `label ?? kind` and the words used to prefer `kind ?? label`,
    // so the two disagreed about what a thing was called.
    const text = textOf({
      schema: S,
      kind: "graph",
      data: { nodes: [{ id: "a", label: "Ledger", kind: "datastore" }], edges: [] },
    });
    expect(text.split("\n").some((line) => line.startsWith("Ledger"))).toBe(true);
  });

  it("says a relationship goes to itself, which the diagram says with a loop", () => {
    expect(textOf(graph)).toContain("to itself");
  });

  it("reports additions, changes and removals without the picture", () => {
    const text = textOf(graph);
    expect(text).toContain("added");
    expect(text).toContain("changed");
    expect(text).toContain("Ledger" === "" ? "" : "Battery manager");
    expect(text).toContain("removed relationship: REL-9");
  });

  it("counts what there is, so a reader knows how much they are not seeing", () => {
    expect(textOf(graph)).toContain("4 elements, 3 relationships");
  });

  const sequence = {
    schema: S,
    kind: "sequence",
    target: "artifact-2",
    data: {
      participants: [
        { id: "user", label: "User", kind: "actor" },
        { id: "api", label: "API", kind: "service" },
        { id: "idle", label: "Audit", kind: "service" },
      ],
      messages: [
        { from: "user", to: "api", label: "submit" },
        { from: "api", to: "user", label: "receipt" },
      ],
    },
  };

  it("lists sequence participants, including one no message reaches", () => {
    // The words used to walk the messages only, so a participant drawn on screen with
    // its own lifeline was missing from the account entirely.
    const text = textOf(sequence);
    for (const name of ["User", "API", "Audit"]) expect(text).toContain(name);
    expect(text).toContain("3 participants, 2 messages");
  });

  it("states a participant's type too", () => {
    const text = textOf(sequence);
    expect(text).toContain("[actor]");
    expect(text).toContain("[service]");
  });

  it("keeps the messages numbered and in their declared order", () => {
    const text = textOf(sequence);
    expect(text.indexOf("1. User")).toBeGreaterThan(-1);
    expect(text.indexOf("1. User")).toBeLessThan(text.indexOf("2. API"));
  });
});

describe("the canvas gesture does not swallow the controls drawn on it", () => {
  const typed = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "a", label: "A", kind: "block" },
        { id: "b", label: "B", kind: "store" },
      ],
      edges: [{ from: "a", to: "b", kind: "calls" }],
    },
  };

  const scrollable = (element: HTMLElement) => {
    Object.defineProperty(element, "scrollWidth", { value: 1000, configurable: true });
    Object.defineProperty(element, "clientWidth", { value: 600, configurable: true });
    Object.defineProperty(element, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(element, "clientHeight", { value: 100, configurable: true });
    element.scrollLeft = 200;
    return element;
  };

  it("declines a press that landed on the key, so the key stays clickable", () => {
    /**
     * The regression this exists for: panning ran on any press on the canvas, called
     * preventDefault, and captured the pointer — which suppresses the click the
     * browser would otherwise deliver. Filtering was completely inert in the browser
     * while the suite stayed green, because the tests dispatched a click directly at
     * the entry and never made the press that came before it.
     *
     * jsdom does not model click suppression, so what is asserted here is the cause
     * rather than the symptom: the pan gesture must not start at all.
     */
    renderBody(withStructured(typed));
    const svg = document.querySelector('svg[role="img"]')! as SVGSVGElement;
    const scroller = scrollable(svg.parentElement as HTMLElement);
    const entry = document.querySelector('[data-legend-entry="element:block"] text')!;

    entry.dispatchEvent(
      Object.assign(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 500, clientY: 50, button: 0 }), {
        pointerId: 1,
      }),
    );
    svg.dispatchEvent(
      Object.assign(new MouseEvent("pointermove", { bubbles: true, clientX: 400, clientY: 50, button: 0 }), { pointerId: 1 }),
    );

    expect(scroller.scrollLeft, "a press on the key must not begin a pan").toBe(200);
  });

  it("does not cancel the browser's default on a press that belongs to the key", () => {
    renderBody(withStructured(typed));
    const entry = document.querySelector('[data-legend-entry="element:block"] text')!;
    const press = Object.assign(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0 }),
      { pointerId: 1 },
    );

    entry.dispatchEvent(press);

    // preventDefault here is exactly what suppresses the click that follows
    expect(press.defaultPrevented).toBe(false);
  });

  it("still pans from the ground beside the drawing", () => {
    renderBody(withStructured(typed));
    const svg = document.querySelector('svg[role="img"]')! as SVGSVGElement;
    const scroller = scrollable(svg.parentElement as HTMLElement);

    svg.dispatchEvent(
      Object.assign(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 500, clientY: 50, button: 0 }), {
        pointerId: 1,
      }),
    );
    svg.dispatchEvent(
      Object.assign(new MouseEvent("pointermove", { bubbles: true, clientX: 440, clientY: 50, button: 0 }), { pointerId: 1 }),
    );

    expect(scroller.scrollLeft).toBe(260);
  });
});

describe("what the reader is shown is what would be applied", () => {
  /**
   * Three invariants that hold by construction rather than by a code path, and are
   * asserted here as invariants — a test that merely exercised them would be testing
   * that absent code stays absent, which is not what makes them true.
   */

  it("proposes no removal for something a proposal simply does not mention", () => {
    // OmissionDoesNotRemove. The application never holds the authority's full model:
    // it sees one document, so it cannot know what is missing from it, and could not
    // infer a removal even if the contract allowed one. Removals are declared or they
    // do not exist.
    const proposalOmittingPlenty = {
      schema: S,
      kind: "graph",
      target: "artifact-1",
      data: {
        nodes: [{ id: "one", ref: "EL-1", label: "The only one mentioned" }],
        edges: [],
      },
    };
    renderBody(withStructured(proposalOmittingPlenty));

    expect(screen.queryByTestId("structured-removals")).toBeNull();
    expect(document.querySelectorAll('[data-relationship-role="removed"]')).toHaveLength(0);
    fireEvent.click(screen.getByText("show text equivalent"));
    expect(screen.getByTestId("structured-text-equivalent").textContent).not.toContain("removed");
  });

  it("presents exactly the removals declared, and no more", () => {
    const withRemovals = {
      schema: S,
      kind: "graph",
      target: "artifact-1",
      removals: [{ type: "element", ref: "EL-7" }],
      data: { nodes: [{ id: "a", ref: "EL-1", label: "Kept" }], edges: [] },
    };
    renderBody(withStructured(withRemovals));

    const shown = screen.getByTestId("structured-removals");
    expect(shown.querySelectorAll("li")).toHaveLength(1);
    expect(shown.textContent).toContain("EL-7");
  });

  it("never reads diagram syntax back, whatever is sitting beside the data", () => {
    // DiagramSyntaxIsNeverAnInput. The export is a one-way door: there is no parser
    // of diagram syntax anywhere in the path that produces, completes or corrects a
    // document. Mermaid in the tool's own output must therefore change nothing.
    const document_ = {
      schema: S,
      kind: "graph",
      data: { nodes: [{ id: "a", label: "A" }], edges: [] },
    };
    const hostileOutput = [
      "flowchart TD",
      '  nX["Injected"]',
      "  nX --> nY",
      "sequenceDiagram",
      "  participant Z as Zed",
    ].join("\n");

    renderBody(withStructured(document_, { output: hostileOutput }));

    // One element, no relationships: exactly the document, none of the syntax
    expect(document.querySelectorAll("[data-element-role]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-relationship-role]")).toHaveLength(0);
    expect(document.querySelector("svg")!.textContent).not.toContain("Injected");
    expect(document.querySelector("svg")!.textContent).not.toContain("Zed");
  });

  it("offers no way to turn diagram syntax into a document", () => {
    // The structural half of the same invariant: the module exports a way out and
    // deliberately no way back in.
    const exported = Object.keys(structuredExchangeModule);
    expect(exported).toContain("toMermaid");
    expect(exported.filter((name) => /^(from|parse|read)Mermaid/i.test(name))).toEqual([]);
  });

  it("is recoverable as validated, after being validated and rendered", () => {
    /**
     * ValidatedProposalIsRecoverableAsValidated.
     *
     * There is no approval action and no handover step in this system, and the test
     * does not invent one: a proposal is shown so a person can judge it, and carrying
     * their decision anywhere belongs to whatever integrates this. What is asserted is
     * what this side owes — that the document is still the document, after validation
     * and after rendering, for whatever comes to fetch it.
     *
     * Not identity with the bytes the *producer* wrote: those do not survive to this
     * side of the process, and claiming otherwise would be a promise nothing keeps.
     */
    const serialized = JSON.stringify({
      schema: S,
      kind: "graph",
      target: "artifact-1",
      data: {
        nodes: [
          { id: "b", label: "Second declared" },
          { id: "a", ref: "EL-1", label: "First declared", set: { label: "Renamed" } },
        ],
        edges: [{ from: "a", to: "b", kind: "calls" }],
      },
    });
    const item = tool({ structured: serialized });

    // Validated, rendered, and still the same string afterwards
    expect(validStructuredExchange(item.structured)).toBeDefined();
    renderBody(item);
    expect(item.structured).toBe(serialized);

    // Including declaration order, which a parse and re-serialise would be free to
    // keep and a normalising step would not.
    expect(JSON.parse(item.structured!).data.nodes.map((n: { id: string }) => n.id)).toEqual(["b", "a"]);
  });
});

describe("saying what a relationship is when the picture cannot", () => {
  const graph = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "a", label: "Battery", kind: "storage" },
        { id: "b", label: "Inverter", kind: "converter" },
      ],
      edges: [{ from: "a", to: "b", kind: "supplies_high_voltage_direct_current" }],
    },
  };

  // React synthesises enter/leave from over/out, so a raw `pointerenter` reaches
  // nothing. Moving over it is what a pointer actually does anyway.
  const hover = (over: Element) => fireEvent.pointerMove(over, { clientX: 120, clientY: 90 });

  it("gives a thin line a hit area anyone can actually hover", () => {
    // The drawn line is one or two pixels wide. Without this the tooltip exists and
    // is unreachable, which is the same as not existing.
    renderBody(withStructured(graph));
    const hit = document.querySelector('[data-relationship-role] path[data-edge="hit"]')!;

    expect(Number(hit.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(10);
    expect(hit.getAttribute("stroke")).toBe("transparent");
    expect(hit.getAttribute("pointer-events")).toBe("stroke");
  });

  it("names the relationship, its ends and its type on hover", () => {
    renderBody(withStructured(graph));
    hover(document.querySelector("[data-relationship-role]")!);

    const tip = screen.getByTestId("diagram-tooltip");
    expect(tip.textContent).toContain("Battery");
    expect(tip.textContent).toContain("Inverter");
    expect(tip.textContent).toContain("supplies_high_voltage_direct_current");
  });

  it("places the tooltip against the viewport, not inside the box the diagram scrolls in", () => {
    // A diagram wider than the column scrolls, and the relationships hardest to
    // identify are the ones running off its edge — so the thing explaining them must
    // not be clipped by that same edge.
    renderBody(withStructured(graph));
    hover(document.querySelector("[data-relationship-role]")!);

    expect(screen.getByTestId("diagram-tooltip").style.position).toBe("fixed");
  });

  it("does not let the tooltip catch the pointer it follows", () => {
    renderBody(withStructured(graph));
    hover(document.querySelector("[data-relationship-role]")!);

    expect(screen.getByTestId("diagram-tooltip").className).toContain("pointer-events-none");
  });

  it("puts it away when the pointer leaves", () => {
    renderBody(withStructured(graph));
    const group = document.querySelector("[data-relationship-role]")!;
    hover(group);
    fireEvent.pointerOut(group, { relatedTarget: document.body });

    expect(screen.queryByTestId("diagram-tooltip")).toBeNull();
  });

  it("still carries the native title, for anything driven by the keyboard or a reader", () => {
    renderBody(withStructured(graph));
    expect(document.querySelector("[data-relationship-role] title")!.textContent).toContain("Battery");
  });
});

describe("the enlarged view owns the screen while it is open", () => {
  const graph = {
    schema: S,
    kind: "graph",
    data: { nodes: [{ id: "a", label: "A", kind: "block" }], edges: [] },
  };

  it("is mounted on the document body rather than inside the transcript", () => {
    /**
     * `position: fixed` and a z-index are only as absolute as the nearest ancestor
     * that made a stacking context, and this modal lives deep inside the message
     * list. The composer and the toolbar are other branches with contexts of their
     * own, and they painted over an overlay that was nominally above them — so the
     * controls stayed visible and clickable through a dialog that had claimed the
     * screen.
     */
    const { container } = renderBody(withStructured(graph));
    fireEvent.click(screen.getByText("⤢ enlarge"));

    const modal = screen.getByTestId("structured-enlarged");
    expect(container.contains(modal)).toBe(false);
    expect(modal.parentElement).toBe(document.body);
  });

  it("sits above everything the application draws", () => {
    renderBody(withStructured(graph));
    fireEvent.click(screen.getByText("⤢ enlarge"));

    // Higher than the composer (z-20) and the notification layer (z-40)
    expect(screen.getByTestId("structured-enlarged").className).toContain("z-[100]");
  });

  it("closes on Escape, so nothing behind it is unreachable", () => {
    renderBody(withStructured(graph));
    fireEvent.click(screen.getByText("⤢ enlarge"));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId("structured-enlarged")).toBeNull();
  });
});

describe("a real architecture, at the size real ones come in", () => {
  /**
   * Thirty-three elements, fifty-four relationships, fourteen element types and
   * thirty-four relationship types — a vehicle architecture, not a toy. Everything
   * here failed at least once at this scale and passed at three nodes.
   */
  const KINDS = [
    "energy_storage", "controller", "thermal", "power_distribution", "power_electronics",
    "actuator", "mechanical", "interface", "communication", "hmi", "sensor", "safety",
    "security", "external",
  ];
  const nodes = Array.from({ length: 33 }, (_, index) => ({
    id: `n${index}`,
    label: `Component number ${index}`,
    kind: KINDS[index % KINDS.length],
  }));
  const edges = Array.from({ length: 54 }, (_, index) => ({
    from: `n${index % 33}`,
    to: `n${(index * 7 + 3) % 33}`,
    kind: `relates_${index % 34}`,
  }));
  const big = { schema: S, kind: "graph", data: { nodes, edges } };

  /** How a type is presented: colour and pattern together, which is what tells them apart. */
  const presentations = (scope: "element" | "relationship") =>
    // A relationship's swatch is a line, an element's is a box — both carry the
    // colour and the pattern that tell one type from another.
    [...document.querySelectorAll(`[data-legend-entry^="${scope}:"]`)].map((entry) => {
      const swatch = entry.querySelector('rect:not([fill="transparent"])') ?? entry.querySelector("line")!;
      const paint = swatch.getAttribute("fill") ?? swatch.getAttribute("stroke");
      return `${paint}/${swatch.getAttribute("stroke-dasharray") ?? "solid"}`;
    });

  it("gives fourteen element types fourteen distinct presentations", () => {
    // Elements and relationships shared one colour table, so a diagram with many of
    // both exhausted it and drew unrelated types alike: mechanical and security the
    // same, interface and external the same. Separate tables, and a pattern beside
    // the colour so sixteen colours are not the ceiling.
    renderBody(withStructured(big));

    expect(presentations("element")).toHaveLength(14);
    expect(new Set(presentations("element")).size).toBe(14);
  });

  it("tells thirty-four relationship types apart too", () => {
    // Sixteen colours were not enough and the key admitted it. Sixty-four
    // presentations are, for anything a reader can actually take in.
    renderBody(withStructured(big));

    expect(presentations("relationship")).toHaveLength(34);
    expect(new Set(presentations("relationship")).size).toBe(34);
  });

  it("draws apart as many types as the contract admits", () => {
    // The encoding and the ceiling are one number: a document that would exhaust the
    // palette is refused by validation rather than rendered with two types alike, so
    // there is no "colours repeat" case left for the key to apologise for.
    expect(KIND_PRESENTATIONS).toBe(STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary);

    const atTheCeiling = {
      schema: S,
      kind: "graph",
      data: {
        nodes: Array.from({ length: KIND_PRESENTATIONS }, (_, index) => ({
          id: `n${index}`,
          label: `N${index}`,
          kind: `kind_${index}`,
        })),
        edges: [],
      },
    };
    renderBody(withStructured(atTheCeiling));

    const looks = [...document.querySelectorAll("[data-element-role] rect")].map(
      (box) => `${box.getAttribute("fill")}/${box.getAttribute("stroke-dasharray") ?? "solid"}`,
    );
    expect(looks).toHaveLength(KIND_PRESENTATIONS);
    expect(new Set(looks).size).toBe(KIND_PRESENTATIONS);

    // And the key stays a plain heading, with no caveat to make
    const headings = [...document.querySelectorAll('[data-testid="legend-group"]')].map((t) => t.textContent);
    expect(headings).toContain("elements");
    expect(headings.some((h) => /repeat/.test(h!))).toBe(false);
  });

  it("keeps the key a block, however wide the drawing gets", () => {
    // Wrapped at the canvas width, a three-thousand-pixel diagram spread its key
    // across three thousand pixels: entries so far apart that finding one meant
    // scrolling past the drawing.
    renderBody(withStructured(big));
    const entries = [...document.querySelectorAll("[data-legend-entry] text")];
    const rightmost = Math.max(...entries.map((t) => Number(t.getAttribute("x"))));

    expect(rightmost).toBeLessThan(900);
  });

  it("draws every element and every relationship, none overlapping", () => {
    renderBody(withStructured(big));
    const boxes = [...document.querySelectorAll("[data-element-role] rect")].map((r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    }));

    expect(boxes).toHaveLength(33);
    expect(document.querySelectorAll("[data-relationship-role]")).toHaveLength(54);

    const overlapping = boxes.flatMap((a, i) =>
      boxes.slice(i + 1).filter((b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)),
    );
    expect(overlapping).toEqual([]);
  });

  it("keeps the key inside the canvas it is drawn on", () => {
    renderBody(withStructured(big));
    const svg = document.querySelector('svg[role="img"]')!;
    const [left, , width] = svg.getAttribute("viewBox")!.split(" ").map(Number);

    for (const text of document.querySelectorAll("[data-legend-entry] text")) {
      const right = Number(text.getAttribute("x")) + text.textContent!.length * 5.6;
      expect(right, `"${text.textContent}" runs off the canvas`).toBeLessThanOrEqual(left + width);
    }
  });
});

describe("nothing drawn falls outside the canvas it is drawn on", () => {
  /**
   * The extent came from the boxes alone, and relationships do not stay inside them:
   * a loop is drawn deliberately above its box, and the layout engine routes a long
   * relationship around whatever it spans, which can carry it above the topmost box.
   * Both were cut off at the top edge — visible on a real architecture, invisible to
   * every test, because no test measured anything but the boxes.
   */
  const viewBoxOf = () => {
    const svg = document.querySelector('svg[role="img"]')!;
    const [x, y, w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    return { left: x, top: y, right: x + w, bottom: y + h };
  };

  const everyDrawnPoint = () =>
    [...document.querySelectorAll('[data-relationship-role] path[data-edge="line"]')].flatMap((path) => {
      const numbers = (path.getAttribute("d")!.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      return numbers.reduce<{ x: number; y: number }[]>((points, value, index) => {
        if (index % 2 === 0 && index + 1 < numbers.length) points.push({ x: value, y: numbers[index + 1] });
        return points;
      }, []);
    });

  const assertAllInside = () => {
    const box = viewBoxOf();
    for (const point of everyDrawnPoint()) {
      expect(point.y, `a relationship reaches y=${point.y}, above the canvas top ${box.top}`).toBeGreaterThanOrEqual(box.top);
      expect(point.y, `a relationship reaches y=${point.y}, below the canvas bottom ${box.bottom}`).toBeLessThanOrEqual(box.bottom);
      expect(point.x).toBeGreaterThanOrEqual(box.left);
      expect(point.x).toBeLessThanOrEqual(box.right);
    }
  };

  it("makes room above the topmost box for a relationship that loops over it", () => {
    renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        data: {
          nodes: [{ id: "a", label: "A" }],
          edges: [{ from: "a", to: "a", kind: "feeds" }],
        },
      }),
    );

    // The loop is drawn above the box, so the canvas must start above the box too
    const box = viewBoxOf();
    const rect = document.querySelector("[data-element-role] rect")!;
    expect(box.top).toBeLessThan(Number(rect.getAttribute("y")));
    assertAllInside();
  });

  it("makes room for several loops stacked on one element", () => {
    renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        data: {
          nodes: [{ id: "a", label: "A" }],
          edges: [
            { from: "a", to: "a", kind: "one" },
            { from: "a", to: "a", kind: "two" },
            { from: "a", to: "a", kind: "three" },
          ],
        },
      }),
    );
    assertAllInside();
  });

  it("makes room for a routed relationship that goes around what it spans", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, label: `Node ${index}` }));
    const edges = [
      ...nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id, kind: "chain" })),
      // The long ones: routed around the ranks between their ends
      { from: "n0", to: "n11", kind: "spans" },
      { from: "n11", to: "n0", kind: "returns" },
      { from: "n1", to: "n9", kind: "spans" },
    ];
    renderBody(withStructured({ schema: S, kind: "graph", data: { nodes, edges } }));

    assertAllInside();
  });

  it("keeps everything inside after the reader drags a box upwards", () => {
    renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        data: {
          nodes: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          edges: [
            { from: "a", to: "b", kind: "k" },
            { from: "a", to: "a", kind: "loop" },
          ],
        },
      }),
    );

    dragBox(0, { x: 0, y: -160 });

    assertAllInside();
  });
});

describe("adjusting the view is not editing the document", () => {
  const proposal = {
    schema: S,
    kind: "graph",
    target: "artifact-1",
    data: {
      nodes: [
        { id: "a", label: "A", kind: "service" },
        { id: "b", label: "B", kind: "datastore" },
      ],
      edges: [{ from: "a", to: "b", kind: "writes" }],
    },
  };

  it("leaves the document untouched after a box is moved and a type is hidden", () => {
    // Repositioning and narrowing are for reading. If either reached the document,
    // a reader would be approving something they had themselves altered.
    const serialized = JSON.stringify(proposal);
    const item = tool({ structured: serialized });
    renderBody(item);

    dragBox(0, { x: 0, y: -140 });
    toggleLegend("element:datastore");

    // Exporting reads the rendering and could just as easily normalise what it read
    const created: string[] = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => {
      created.push("blob");
      return "blob:x";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    fireEvent.click(screen.getByText("⤓ download SVG"));
    fireEvent.click(screen.getByText("copy markup"));
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;

    // The view did change, and the export did run — this is not a test of a no-op
    expect(screen.getByTestId("structured-filtered")).toBeTruthy();
    expect(document.querySelectorAll("[data-element-role]")).toHaveLength(1);
    expect(created).toHaveLength(1);

    // …and the document did not
    expect(item.structured).toBe(serialized);
  });
});

describe("a moved box takes its relationships with it", () => {
  /**
   * Dropping the layout route the moment a reader touched a box was the first
   * answer and a poor one: the route is the only thing carrying the bends, so every
   * relationship around that box snapped from a curve going somewhere to a straight
   * line cutting across whatever it had been routed around.
   */
  const chain = {
    schema: S,
    kind: "graph",
    data: {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
      edges: [
        { from: "a", to: "b", kind: "k" },
        { from: "b", to: "c", kind: "k" },
        { from: "c", to: "d", kind: "k" },
        { from: "a", to: "d", kind: "spans" },
      ],
    },
  };

  /** The fourth relationship: a→d, spanning three ranks, so the engine routes it. */
  const routedPath = () =>
    [...document.querySelectorAll('[data-relationship-role] path[data-edge="line"]')][3]?.getAttribute("d");

  it("keeps the rounded route after a box is moved, rather than snapping to a straight line", () => {
    renderBody(withStructured(chain));
    const before = routedPath();
    expect(before, "the spanning relationship should be routed to begin with").toBeDefined();
    expect(before).toContain("Q");

    dragBox(0, { x: 0, y: -90 });

    const after = routedPath();
    expect(after, "the route should survive the drag").toBeDefined();
    expect(after, "and keep its rounded corners").toContain("Q");
    expect(after).not.toBe(before);
  });

  it("moves the route with the end that moved", () => {
    renderBody(withStructured(chain));
    const before = routedPath()!;
    dragBox(0, { x: 0, y: -90 });
    const after = routedPath()!;

    const firstY = (d: string) => Number(d.match(/^M [\d.-]+ ([\d.-]+)/)![1]);
    // The relationship starts at the box that moved, so its start follows it up
    expect(firstY(after)).toBeLessThan(firstY(before));
  });

  it("leaves relationships whose ends did not move exactly where they were", () => {
    renderBody(withStructured(chain));
    const all = () =>
      [...document.querySelectorAll('[data-relationship-role] path[data-edge="line"]')].map((p) => p.getAttribute("d")!);
    const before = all();

    dragBox(0, { x: 0, y: -90 });
    const after = all();

    // c→d touches neither end of the drag
    expect(after[2]).toBe(before[2]);
  });
});

describe("what leaves the application is a figure, not a control", () => {
  const graph = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "a", label: "A", kind: "block" },
        { id: "b", label: "B", kind: "store" },
      ],
      edges: [{ from: "a", to: "b", kind: "calls" }],
    },
  };

  it("offers the diagram as a file, because a document will not take it pasted", () => {
    renderBody(withStructured(graph));
    const button = screen.getByText("⤓ download SVG");
    expect(button.getAttribute("title")).toMatch(/insert it as a picture/i);
  });

  it("leaves no cursor or touch-action in the markup it hands over", () => {
    // Both exist so the gestures work, and neither means anything in a file: there is
    // no pointer in a document and nothing there to drag.
    renderBody(withStructured(graph));
    const onScreen = document.querySelector('svg[role="img"]')! as SVGElement;
    expect(onScreen.getAttribute("style")).toContain("cursor");

    // The same element, prepared for export
    const clean = onScreen.cloneNode(true) as SVGElement;
    for (const element of [clean, ...clean.querySelectorAll<SVGElement>("[style]")]) {
      element.style.removeProperty("cursor");
      element.style.removeProperty("touch-action");
      if (element.getAttribute("style") === "") element.removeAttribute("style");
    }
    const markup = new XMLSerializer().serializeToString(clean);
    expect(markup).not.toContain("cursor");
    expect(markup).not.toContain("touch-action");
    // …and nothing else was lost with them
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain("diagram-legend");
  });

  it("does not disturb the diagram on screen when exporting it", () => {
    renderBody(withStructured(graph));
    const before = document.querySelector('svg[role="img"]')!.outerHTML;
    fireEvent.click(screen.getByText("copy markup"));
    expect(document.querySelector('svg[role="img"]')!.outerHTML).toBe(before);
  });
});

describe("a box holds everything printed in it", () => {
  /**
   * A change is printed inside the box and reads "label: before → after", routinely
   * longer than the name above it. Sized on the name alone, a renamed participant
   * showed "label: Onboard Charger → OBC (11" and stopped at the border — which reads
   * as a truncated value, not as a box that is too small.
   */
  const renamed = (kind: "graph" | "sequence") => {
    const thing = {
      id: "obc",
      ref: "EL-2",
      label: "OBC",
      set: { label: "Onboard Charger, eleven kilowatts, three phase" },
    };
    return kind === "graph"
      ? { schema: S, kind, target: "t", data: { nodes: [thing], edges: [] } }
      : { schema: S, kind, target: "t", data: { participants: [thing], messages: [] } };
  };

  /** Roughly how wide the printed change is, at the size it is printed. */
  const printedWidth = (text: string) => text.length * 5.4;

  for (const kind of ["graph", "sequence"] as const) {
    it(`sizes a ${kind} box to its change, not only to its name`, () => {
      renderBody(withStructured(renamed(kind)));

      const written = [...document.querySelectorAll('[data-testid="field-changes"]')].map((t) => t.textContent!);
      const rect = document.querySelector("[data-element-role] rect")!;
      const boxWidth = Number(rect.getAttribute("width"));

      // Nothing lost: the whole change is still readable, across however many lines
      expect(written.join(" ")).toContain("Onboard Charger, eleven kilowatts, three phase");

      for (const line of written) {
        expect(
          printedWidth(line),
          `"${line}" needs ~${Math.round(printedWidth(line))}px and the box is ${boxWidth}px`,
        ).toBeLessThanOrEqual(boxWidth);
      }
    });
  }

  it("does not widen a box that has no change to show", () => {
    // The change only pays for itself when there is one.
    renderBody(
      withStructured({ schema: S, kind: "graph", data: { nodes: [{ id: "a", label: "OBC" }], edges: [] } }),
    );
    const width = Number(document.querySelector("[data-element-role] rect")!.getAttribute("width"));
    expect(width).toBeLessThanOrEqual(140);
  });
});

describe("what the proposal note claims", () => {
  it("does not claim that only what changes is shown, because that is not true", () => {
    /**
     * It was true before a producer could include an element for context, and the
     * sentence outlived the semantics. A reader told "only what changes is shown",
     * looking at a participant drawn plainly beside two that are marked, has been
     * told the wrong thing about it.
     */
    const withContext = {
      schema: S,
      kind: "graph",
      target: "artifact-1",
      data: {
        nodes: [
          { id: "keep", ref: "EL-1", label: "Existing, unchanged, shown so you can place the rest" },
          { id: "fresh", label: "Brand new" },
        ],
        edges: [],
      },
    };
    renderBody(withStructured(withContext));

    const note = screen.getByTestId("structured-proposal-note").textContent!;
    expect(note).not.toContain("Only what changes is shown");
    expect(note).toContain("not mentioned is left as it is");
    expect(note).toContain("context");

    // And the note is describing something actually on screen
    expect(document.querySelectorAll('[data-element-role="context"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-element-role="added"]')).toHaveLength(1);
  });

  it("says nothing of the sort for a new artifact", () => {
    renderBody(withStructured(newArtifact));
    expect(screen.queryByTestId("structured-proposal-note")).toBeNull();
  });
});

describe("the same pointer answer, whatever the diagram", () => {
  /**
   * The tooltip began on graph relationships, because that was where a label had to
   * be dropped for want of room. A box's name is truncated for the same reason, a
   * sequence has both, and a reader should not have to learn which parts of which
   * diagram answer to a pointer.
   */
  const graph = {
    schema: S,
    kind: "graph",
    data: {
      nodes: [
        { id: "a", label: "Battery", kind: "storage" },
        { id: "b", label: "Inverter", kind: "converter" },
      ],
      edges: [{ from: "a", to: "b", kind: "supplies" }],
    },
  };
  const sequence = {
    schema: S,
    kind: "sequence",
    data: {
      participants: [
        { id: "a", label: "Driver", kind: "actor" },
        { id: "b", label: "Charge Port", kind: "interface" },
      ],
      messages: [{ from: "a", to: "b", label: "plug in" }],
    },
  };

  const hover = (selector: string) => {
    fireEvent.pointerMove(document.querySelector(selector)!, { clientX: 120, clientY: 90 });
    return screen.getByTestId("diagram-tooltip").textContent!;
  };

  it("answers on a graph element", () => {
    renderBody(withStructured(graph));
    expect(hover("[data-element-role]")).toContain("Battery");
  });

  it("answers on a graph relationship", () => {
    renderBody(withStructured(graph));
    const text = hover("[data-relationship-role]");
    expect(text).toContain("Battery");
    expect(text).toContain("Inverter");
    expect(text).toContain("supplies");
  });

  it("answers on a sequence participant", () => {
    renderBody(withStructured(sequence));
    expect(hover("[data-element-role]")).toContain("Driver");
  });

  it("answers on a sequence message, naming both ends", () => {
    // On a lifeline diagram the arrow gives the direction and nothing gives the who,
    // once the diagram has scrolled away from the headers.
    renderBody(withStructured(sequence));
    const text = hover("[data-message-index]");
    expect(text).toContain("Driver");
    expect(text).toContain("Charge Port");
    expect(text).toContain("plug in");
  });

  it("uses one testid, so the two diagrams cannot drift apart again", () => {
    for (const document_ of [graph, sequence]) {
      const view = renderBody(withStructured(document_));
      fireEvent.pointerMove(document.querySelector("[data-element-role]")!, { clientX: 1, clientY: 1 });
      expect(screen.getAllByTestId("diagram-tooltip")).toHaveLength(1);
      view.unmount();
    }
  });

  it("says the same thing to a pointer and to a screen reader", () => {
    // Two summaries of one thing drift; the title and the tooltip are one string.
    renderBody(withStructured(sequence));
    const message = document.querySelector("[data-message-index]")!;
    const title = message.querySelector("title")!.textContent;
    fireEvent.pointerMove(message, { clientX: 5, clientY: 5 });
    expect(screen.getByTestId("diagram-tooltip").textContent).toBe(title);
  });
});

describe("the key shows what the picture shows", () => {
  /**
   * A key that draws a swatch the diagram never uses is worse than no key: it is a
   * statement about the picture that is false. Both of these were.
   */
  it("gives a sequence participant type the pattern it is drawn with", () => {
    // The sequence key passed the colour and dropped the dash, so it stopped matching
    // the boxes the moment a diagram carried more types than there are colours.
    const participants = Array.from({ length: 20 }, (_, index) => ({
      id: `p${index}`,
      label: `P${index}`,
      kind: `kind_${index}`,
    }));
    renderBody(
      withStructured({ schema: S, kind: "sequence", data: { participants, messages: [] } }),
    );

    const drawn = [...document.querySelectorAll("[data-element-role] rect")].map(
      (box) => `${box.getAttribute("fill")}/${box.getAttribute("stroke-dasharray") ?? "solid"}`,
    );
    const key = [...document.querySelectorAll('[data-legend-entry^="element:"] rect:not([fill="transparent"])')].map(
      (swatch) => `${swatch.getAttribute("fill")}/${swatch.getAttribute("stroke-dasharray") ?? "solid"}`,
    );

    // More types than colours, so the pattern is doing real work here
    expect(new Set(drawn).size).toBe(20);
    expect(new Set(key)).toEqual(new Set(drawn));
  });

  for (const [kind, document_] of [
    [
      "graph",
      {
        schema: S,
        kind: "graph",
        target: "t",
        data: {
          nodes: [
            { id: "a", ref: "EL-1", label: "Existing" },
            { id: "b", label: "New" },
          ],
          edges: [],
        },
      },
    ],
    [
      "sequence",
      {
        schema: S,
        kind: "sequence",
        target: "t",
        data: {
          participants: [
            { id: "a", ref: "EL-1", label: "Existing" },
            { id: "b", label: "New" },
          ],
          messages: [],
        },
      },
    ],
  ] as const) {
    it(`marks context in the ${kind} key the way the ${kind} marks it`, () => {
      // Context is dimmed now, not dashed — the dash says what kind of thing it is.
      renderBody(withStructured(document_));

      const entry = document.querySelector('[data-legend-entry="existing"]')!;
      expect(entry, "the key should explain the context role it is showing").not.toBeNull();
      expect(entry.getAttribute("data-faded")).toBe("true");
      expect(entry.querySelector("rect")!.getAttribute("stroke-dasharray")).toBeNull();

      // …and the thing it describes is dimmed too
      const shown = document.querySelector('[data-element-role="context"] rect')!;
      expect(Number(shown.getAttribute("opacity"))).toBeLessThan(1);
    });
  }
});

/**
 * Containers group what is drawn without changing how it is drawn. The second
 * half of that sentence is the one worth testing: the promise is that a producer
 * can add grouping to an existing document and get the same diagram back with
 * boxes around parts of it, not a redrawn one.
 */
describe("containers", () => {
  const nodes = [
    { id: "battery", label: "Battery" },
    { id: "alternator", label: "Alternator" },
    { id: "ecu", label: "Engine control unit" },
    { id: "driver", label: "Driver" },
  ];
  const edges = [
    { from: "driver", to: "ecu", kind: "operates" },
    { from: "ecu", to: "battery", kind: "reads" },
    { from: "alternator", to: "battery", kind: "charges" },
  ];
  const ungrouped = { schema: S, kind: "graph", data: { nodes, edges } };
  const grouped = {
    schema: S,
    kind: "graph",
    data: {
      containers: [
        { id: "electrical", label: "Electrical system" },
        { id: "hydraulic", label: "Hydraulic system" },
      ],
      nodes: nodes.map((node) =>
        node.id === "battery" || node.id === "alternator" ? { ...node, container: "electrical" } : node,
      ),
      edges,
    },
  };

  it("draws every declared container, including one no member names", () => {
    const { container } = renderBody(withStructured(grouped));

    const drawn = [...container.querySelectorAll("[data-container]")].map((g) => g.getAttribute("data-container"));
    expect(drawn).toEqual(["electrical", "hydraulic"]);
    expect(screen.getByText("Electrical system")).toBeInTheDocument();
    expect(screen.getByText("Hydraulic system")).toBeInTheDocument();
  });

  it("lays every member out inside its own container and no other", () => {
    const { container } = renderBody(withStructured(grouped));

    const box = (selector: string) => {
      const rect = container.querySelector(selector)!.querySelector("rect")!;
      const read = (name: string) => Number(rect.getAttribute(name));
      return { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
    };
    const enclosure = box('[data-container="electrical"]');
    const contains = (inner: { x: number; y: number; width: number; height: number }) =>
      inner.x >= enclosure.x &&
      inner.y >= enclosure.y &&
      inner.x + inner.width <= enclosure.x + enclosure.width &&
      inner.y + inner.height <= enclosure.y + enclosure.height;

    expect(contains(box('[data-element-id="battery"]'))).toBe(true);
    expect(contains(box('[data-element-id="alternator"]'))).toBe(true);
    // The one outside it must really be outside, or the enclosure means nothing
    expect(contains(box('[data-element-id="driver"]'))).toBe(false);
  });

  it("still renders a relationship that crosses a boundary", () => {
    const { container } = renderBody(withStructured(grouped));

    // ecu is outside the enclosure, battery is inside it
    expect(container.querySelectorAll("[data-relationship-role]")).toHaveLength(edges.length);
  });

  it("draws the elements and relationships exactly as it would without the grouping", () => {
    // The claim in the spec: adding containers adds geometry around a diagram and
    // takes nothing away from it.
    const geometry = (document: unknown) => {
      const { container, unmount } = renderBody(withStructured(document));
      const boxes = [...container.querySelectorAll("[data-element-id]")].map((g) => ({
        id: g.getAttribute("data-element-id"),
        d: [...g.querySelectorAll("rect")].map((r) => r.getAttribute("width") + "x" + r.getAttribute("height")).join(),
      }));
      const relationships = container.querySelectorAll("[data-relationship-role]").length;
      unmount();
      return { boxes, relationships };
    };

    expect(geometry(grouped)).toEqual(geometry(ungrouped));
  });
});

/**
 * A sequence keeps its columns. A container is a header over them, and the only
 * thing it may move is the order of the columns themselves — because a header
 * can only span columns that touch.
 */
describe("sequence containers", () => {
  const sequence = (over: Record<string, unknown>) => ({
    schema: S,
    kind: "sequence",
    data: {
      messages: [
        { from: "battery", to: "ecu", label: "voltage" },
        { from: "ecu", to: "dash", label: "warning" },
      ],
      ...over,
    },
  });

  const columns = (container: HTMLElement) =>
    [...container.querySelectorAll("[data-element-id]")].map((g) => ({
      id: g.getAttribute("data-element-id"),
      x: Number(g.querySelector("rect")!.getAttribute("x")),
    }))
      .sort((a, b) => a.x - b.x)
      .map((column) => column.id);

  it("orders interleaved members so each container is drawn with one header", () => {
    // Declared battery(E), ecu(C), alternator(E), dash(C) — as written, neither
    // container occupies adjacent columns.
    const { container } = renderBody(
      withStructured(
        sequence({
          containers: [
            { id: "electrical", label: "Electrical system" },
            { id: "control", label: "Control system" },
          ],
          participants: [
            { id: "battery", label: "Battery", container: "electrical" },
            { id: "ecu", label: "ECU", container: "control" },
            { id: "alternator", label: "Alternator", container: "electrical" },
            { id: "dash", label: "Dashboard", container: "control" },
          ],
        }),
      ),
    );

    expect(columns(container)).toEqual(["battery", "alternator", "ecu", "dash"]);
    // One band each, not two for a split container
    const bands = [...container.querySelectorAll("[data-container]")].map((g) => g.getAttribute("data-container"));
    expect(bands).toEqual(["electrical", "control"]);
  });

  it("leaves declared column order alone when nothing is grouped", () => {
    const { container } = renderBody(
      withStructured(
        sequence({
          participants: [
            { id: "battery", label: "Battery" },
            { id: "ecu", label: "ECU" },
            { id: "dash", label: "Dashboard" },
          ],
        }),
      ),
    );

    expect(columns(container)).toEqual(["battery", "ecu", "dash"]);
    expect(container.querySelectorAll("[data-container]")).toHaveLength(0);
  });

  it("keeps an ungrouped participant in its place", () => {
    const { container } = renderBody(
      withStructured(
        sequence({
          containers: [{ id: "control", label: "Control system" }],
          participants: [
            { id: "battery", label: "Battery" },
            { id: "ecu", label: "ECU", container: "control" },
            { id: "dash", label: "Dashboard", container: "control" },
          ],
        }),
      ),
    );

    expect(columns(container)).toEqual(["battery", "ecu", "dash"]);
  });

  it("still draws one lifeline per participant and every message", () => {
    const { container } = renderBody(
      withStructured(
        sequence({
          containers: [{ id: "control", label: "Control system" }],
          participants: [
            { id: "battery", label: "Battery" },
            { id: "ecu", label: "ECU", container: "control" },
            { id: "dash", label: "Dashboard", container: "control" },
          ],
        }),
      ),
    );

    expect(container.querySelectorAll('line[stroke-dasharray="3 3"]')).toHaveLength(3);
    expect(container.querySelectorAll("[data-relationship-role]")).toHaveLength(2);
  });
});

describe("the textual equivalent carries membership", () => {
  const grouped = {
    schema: S,
    kind: "graph",
    data: {
      containers: [
        { id: "electrical", label: "Electrical system" },
        { id: "hydraulic", label: "Hydraulic system" },
      ],
      nodes: [
        { id: "battery", label: "Battery", container: "electrical" },
        { id: "driver", label: "Driver" },
      ],
      edges: [{ from: "driver", to: "battery", kind: "operates" }],
    },
  };

  it("names every container, its members, and what belongs to none", () => {
    renderBody(withStructured(grouped));
    fireEvent.click(screen.getByText(/show text equivalent/));

    const text = screen.getByTestId("structured-text-equivalent").textContent ?? "";
    // A reader here cannot see the boxes, so an empty one has to be said out loud
    expect(text).toContain("Electrical system: Battery");
    expect(text).toContain("Hydraulic system: no members");
    expect(text).toContain("Battery in Electrical system");
    // The ungrouped one is named without being put anywhere
    expect(text).toMatch(/^Driver$/m);
  });
});

describe("an enclosure follows the member the reader moves", () => {
  const grouped = {
    schema: S,
    kind: "graph",
    data: {
      containers: [{ id: "electrical", label: "Electrical system" }],
      nodes: [
        { id: "battery", label: "Battery", container: "electrical" },
        { id: "alternator", label: "Alternator", container: "electrical" },
        { id: "driver", label: "Driver" },
      ],
      edges: [{ from: "driver", to: "battery", kind: "operates" }],
    },
  };

  const rectOf = (container: HTMLElement, selector: string) => {
    const rect = container.querySelector(selector)!.querySelector("rect")!;
    const read = (name: string) => Number(rect.getAttribute(name));
    return { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
  };
  const holds = (outer: ReturnType<typeof rectOf>, inner: ReturnType<typeof rectOf>) =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;

  it("grows to keep a dragged member inside it", () => {
    // Otherwise the box stays where the layout put it while its member walks out,
    // and the picture says the element belongs somewhere it does not.
    const { container } = renderBody(withStructured(grouped));
    const before = rectOf(container, '[data-container="electrical"]');

    dragBox(0, { x: 140, y: 90 });

    const after = rectOf(container, '[data-container="electrical"]');
    expect(after).not.toEqual(before);
    expect(holds(after, rectOf(container, '[data-element-id="battery"]'))).toBe(true);
    expect(holds(after, rectOf(container, '[data-element-id="alternator"]'))).toBe(true);
  });

  it("does not swallow an element that belongs to no container", () => {
    const { container } = renderBody(withStructured(grouped));

    dragBox(0, { x: 140, y: 90 });

    // Growing to follow a member must not turn a neighbour into a member
    const enclosure = rectOf(container, '[data-container="electrical"]');
    const driver = rectOf(container, '[data-element-id="driver"]');
    expect(holds(enclosure, driver)).toBe(false);
  });
});

describe("a proposal that moves a member", () => {
  it("presents the move as a change to that element, like any other", () => {
    renderBody(
      withStructured({
        schema: S,
        kind: "graph",
        target: "artifact-1",
        data: {
          containers: [
            { id: "electrical", label: "Electrical system" },
            { id: "control", label: "Control system" },
          ],
          nodes: [
            { id: "sensor", ref: "EL-4", label: "Sensor", container: "electrical", set: { container: "control" } },
          ],
          edges: [],
        },
      }),
    );
    fireEvent.click(screen.getByText(/show text equivalent/));

    const text = screen.getByTestId("structured-text-equivalent").textContent ?? "";
    expect(text).toContain("(changed)");
    expect(text).toMatch(/container.*electrical.*control/);
  });
});
