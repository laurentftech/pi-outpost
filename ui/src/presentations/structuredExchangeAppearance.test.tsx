/**
 * The project's colours, as the reader draws them.
 *
 * Supplied once, by context, and applied by every drawing under it: a tool card's
 * timeline and graph, and a reply's block. The envelope the reader can open is still
 * the document that was presented, with no colour in it.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import type { ProjectAppearance } from "@pi-outpost/shared/structured-exchange/profile";
import { structuredExchangePresentation } from "./StructuredExchangeView";
import { StructuredAppearanceContext } from "./structuredAppearance";
import { AssistantMessage } from "../components/AssistantMessage";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const withStructured = (document: unknown): ToolItem => ({
  kind: "tool",
  toolCallId: "t1",
  toolName: "present_structure",
  args: {},
  output: "presented",
  structured: JSON.stringify(document),
});

const timeline = {
  schema: "urn:structured-exchange:3",
  kind: "timeline",
  data: {
    time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
    rows: [
      {
        type: "task",
        id: "T1",
        label: "Reviews",
        items: [
          { type: "activity", start: "2027-01-01", end: "2027-02-28", kind: "study", label: "Study" },
          { type: "milestone", date: "2027-03-01", kind: "SRR", label: "System Requirements Review" },
          { type: "milestone", date: "2027-06-01", kind: "PDR" },
        ],
      },
    ],
  },
};

const graph = {
  schema: "urn:structured-exchange:2",
  kind: "graph",
  data: {
    nodes: [
      { id: "s", label: "Wheel sensor", kind: "sensor" },
      { id: "e", label: "ECU", kind: "controller" },
    ],
    edges: [{ from: "s", to: "e", kind: "signal" }],
  },
};

const appearance: ProjectAppearance = { kinds: { SRR: { color: "#dc2626" }, sensor: { color: "#0d9488" } } };

const renderTool = (document: unknown, value: ProjectAppearance | null = appearance) =>
  render(
    <StructuredAppearanceContext.Provider value={value}>
      <structuredExchangePresentation.Expanded item={withStructured(document)} dispatch={vi.fn()} />
    </StructuredAppearanceContext.Provider>,
  );

const starFill = (root: HTMLElement, kind: string) =>
  root.querySelector(`[data-testid="timeline-milestone"][data-kind="${kind}"] path`)!.getAttribute("fill");

describe("ProjectColoursApplyWhereverAKindIsColoured", () => {
  it("ATimelineMilestoneTakesItsProjectColour", () => {
    renderTool(timeline);
    const drawn = screen.getAllByTestId("timeline")[0];
    expect(starFill(drawn, "SRR")).toBe("#dc2626");
    const entry = within(drawn).getByTestId("timeline-legend").querySelector('[data-kind="SRR"]')!;
    expect(entry.getAttribute("data-colour-source")).toBe("project");
    expect(entry).toHaveTextContent("(project colour)");
    // An undeclared kind is automatic, and not the declared red.
    expect(starFill(drawn, "PDR")).not.toBe("#dc2626");
    expect(within(drawn).getByTestId("timeline-legend").querySelector('[data-kind="PDR"]')!.getAttribute("data-colour-source")).toBeNull();
  });

  it("a graph element in a tool card takes its project colour", () => {
    renderTool(graph);
    const svg = document.querySelector('svg[aria-label^="Graph of"]')!;
    expect(svg.innerHTML).toContain("#0d9488");
    expect(svg.querySelector('[data-colour-source="project"]')).not.toBeNull();
  });

  it("a timeline in a reply takes the project colour too", () => {
    const item: Extract<ChatItem, { kind: "assistant" }> = {
      kind: "assistant",
      blocks: [{ type: "text", text: `Here:\n\n\`\`\`json\n${JSON.stringify(timeline, null, 2)}\n\`\`\`\n` }],
    };
    render(
      <StructuredAppearanceContext.Provider value={appearance}>
        <AssistantMessage item={item} onOpenFile={vi.fn()} />
      </StructuredAppearanceContext.Provider>,
    );
    expect(starFill(screen.getAllByTestId("timeline")[0], "SRR")).toBe("#dc2626");
  });

  it("NoAppearanceChangesNothing (in the reader)", () => {
    const { unmount } = renderTool(timeline, null);
    const automatic = starFill(screen.getAllByTestId("timeline")[0], "SRR");
    expect(automatic).not.toBe("#dc2626");
    expect(document.querySelector('[data-colour-source="project"]')).toBeNull();
    unmount();
    renderTool(timeline, {});
    expect(starFill(screen.getAllByTestId("timeline")[0], "SRR")).toBe(automatic);
  });

  it("TheDocumentIsUntouched", () => {
    renderTool(timeline);
    fireEvent.click(screen.getByText("show envelope"));
    const shown = screen.getByTestId("structured-envelope").textContent!;
    expect(JSON.parse(shown)).toEqual(timeline);
    expect(shown).not.toContain("#dc2626");
  });

  it("ASharedDeclaredColourIsSaid (timeline legend)", () => {
    renderTool(timeline, { kinds: { SRR: { color: "#dc2626" }, PDR: { color: "#dc2626" } } });
    const legend = within(screen.getAllByTestId("timeline")[0]).getByTestId("timeline-legend");
    expect(legend.querySelector('[data-kind="SRR"]')).toHaveTextContent("same colour as PDR");
    expect(legend.querySelector('[data-kind="PDR"]')).toHaveTextContent("same colour as SRR");
  });
});
