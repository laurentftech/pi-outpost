/**
 * Taking a table away as Markdown, from the reader's side.
 *
 * What the Markdown says is decided and tested under Node, once. What is left for a
 * mounted component is that the control exists beside CSV and XLSX, and that pressing
 * it hands the browser exactly the Markdown the shared export produces for the rows
 * the reader is looking at.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ChatItem, StructuredTableData } from "@pi-outpost/shared";
import { tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";
import { structuredExchangePresentation } from "./StructuredExchangeView";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const specification = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  data: {
    columns: ["id", "requirement"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      { id: "r1", kind: "requirement", cells: ["REQ-1", "Stop | within 40 m"] },
      { heading: "1.1 Sensing", depth: 2 },
      { id: "r2", kind: "requirement", cells: ["REQ-2", "Read wheel speed"] },
    ],
  },
};

const item: ToolItem = {
  kind: "tool",
  toolCallId: "t1",
  toolName: "present_structure",
  args: {},
  output: "presented",
  structured: JSON.stringify(specification),
};

function captureDownload() {
  const anchors: HTMLAnchorElement[] = [];
  const blobs: Blob[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, ...rest: unknown[]) => {
    const element = realCreate(tag, ...(rest as []));
    if (tag === "a") (element as HTMLAnchorElement).click = () => anchors.push(element as HTMLAnchorElement);
    return element;
  });
  vi.stubGlobal("URL", { ...URL, createObjectURL: (blob: Blob) => (blobs.push(blob), "blob:table"), revokeObjectURL: () => {} });
  return { anchors, blobs };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Markdown export control", () => {
  it("sits beside CSV and XLSX, and hands over the shared export's Markdown for the rows shown", async () => {
    // MarkdownExportRunsWithoutABrowser, from the reader's side: the same text the headless export writes.
    render(<structuredExchangePresentation.Expanded item={item} dispatch={vi.fn()} />);
    expect(screen.getByText(/download CSV/)).toBeTruthy();
    expect(screen.getByText(/download XLSX/)).toBeTruthy();
    const { anchors, blobs } = captureDownload();

    fireEvent.click(screen.getByText(/download Markdown/));

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("table-data.md");
    const text = await blobs[0].text();
    expect(text).toBe(tableMarkdown(specification.data as unknown as StructuredTableData));
    expect(text).toContain("### 1.1 Sensing");
    expect(text).toContain("Stop \\| within 40 m");
  });
});

describe("an export of a narrowed table", () => {
  const roled = {
    schema: "urn:structured-exchange:2",
    kind: "table",
    data: {
      columns: ["id", "requirement"],
      rows: [
        { id: "r1", role: "added", cells: ["REQ-5", "Log every actuation"] },
        { id: "r2", role: "removed", cells: ["REQ-3", "Read battery voltage"] },
        { id: "r3", role: "context", cells: ["REQ-1", "Stop within 40 m"] },
      ],
    },
  };
  const roledItem: ToolItem = { ...item, toolCallId: "t2", structured: JSON.stringify(roled) };

  it("says on the controls that it leaves hidden rows out, and leaves them out", async () => {
    // ANarrowedTableExportsWhatItShows, from the reader's side
    render(<structuredExchangePresentation.Expanded item={roledItem} dispatch={vi.fn()} />);
    expect(screen.queryByTestId("table-export-narrowed")).toBeNull();

    fireEvent.click(within(screen.getByTestId("table-role-key")).getByText("removed"));

    expect(screen.getByTestId("table-export-narrowed").textContent).toBe("exports 1 rows fewer than the table declares");
    for (const control of [/download CSV/, /download XLSX/, /download Markdown/]) {
      expect(screen.getByText(control).getAttribute("title")).toMatch(/— 1 hidden rows are left out$/);
    }
    const { blobs } = captureDownload();
    fireEvent.click(screen.getByText(/download Markdown/));
    fireEvent.click(screen.getByText(/download CSV/));
    const [markdown, csv] = await Promise.all(blobs.map((blob) => blob.text()));
    const shown = { ...roled.data, rows: roled.data.rows.filter((row) => row.role !== "removed") };
    expect(markdown).toBe(tableMarkdown(shown as unknown as StructuredTableData));
    expect(markdown).not.toContain("Read battery voltage");
    expect(csv).not.toContain("Read battery voltage");
    expect(csv).toContain("Log every actuation");
  });
});
